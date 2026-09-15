"""Загрузка сырья из бакета в посадочный слой Postgres.

Здесь НЕ происходит разбора и типизации: JSON кладётся в jsonb как есть.
Типизация и нормализация — задача dbt на staging. Это позволяет
перезалить и пересчитать всю историю при изменении логики разбора,
не обращаясь к источнику заново.

    python -m ingestion.load_to_postgres                 # все даты, которых нет
    python -m ingestion.load_to_postgres --dt 2026-09-12
    python -m ingestion.load_to_postgres --full          # перезалить всё
"""

from __future__ import annotations

import argparse
import logging
import re
import sys
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb

from ingestion.config import PostgresConfig, S3Config
from ingestion.storage.s3 import RawStorage

log = logging.getLogger("talap.load")

SCHEMA_FILE = Path(__file__).parent / "sql" / "001_schema.sql"
BATCH = 1000


def apply_schema(conn: psycopg.Connection) -> None:
    """Применяет 001_schema.sql по одному оператору.

    Одним execute нельзя: поведение с несколькими операторами в psycopg3
    зависит от того, каким протоколом уходит запрос. Разбиваем явно.
    """
    script = SCHEMA_FILE.read_text(encoding="utf-8")
    statements = [
        stmt.strip()
        for stmt in script.split(";")
        if stmt.strip() and not all(
            line.strip().startswith("--") or not line.strip()
            for line in stmt.splitlines()
        )
    ]
    with conn.cursor() as cur:
        for stmt in statements:
            cur.execute(stmt)  # noqa: S608 — статический DDL из файла в репозитории
    conn.commit()


def _dates_in_bucket(storage: RawStorage, prefix: str) -> set[str]:
    return {m.group(1) for k in storage.list_keys(prefix)
            if (m := re.search(r"dt=([\d-]+)", k))}


# Какие даты ещё не загружены. Считать по одной таблице нельзя: источники
# появляются в разное время, и дата, закрытая по hh, молча похоронила бы
# телеграм за тот же день — без ошибки, просто «новых дат нет».
_LOADED_FROM = {
    "raw/hh/": "SELECT DISTINCT dt::text FROM raw_landing.hh_vacancies",
    "raw/telegram/": "SELECT DISTINCT dt::text FROM raw_landing.telegram_posts",
    "raw/currency/": "SELECT DISTINCT dt::text FROM raw_landing.currency_rates",
}


def _pending(conn: psycopg.Connection, storage: RawStorage) -> set[str]:
    pending: set[str] = set()
    with conn.cursor() as cur:
        for prefix, query in _LOADED_FROM.items():
            cur.execute(query)
            loaded = {r[0] for r in cur.fetchall()}
            pending |= _dates_in_bucket(storage, prefix) - loaded
    return pending


def load_hh(conn: psycopg.Connection, storage: RawStorage, dt: str) -> dict:
    counts = {"list": 0, "details": 0, "counters": 0}
    with conn.cursor() as cur:
        for country in ("kz", "uz", "kg"):
            base = f"raw/hh/country={country}/dt={dt}/"

            for kind, prefix in (("list", "vacancies_list-"), ("details", "vacancy_details-")):
                rows = []
                for key in sorted(storage.list_keys(base + prefix)):
                    for item in storage.read_json(key) or []:
                        if sid := item.get("id"):
                            rows.append((str(sid), country, dt, kind, Jsonb(item)))
                for i in range(0, len(rows), BATCH):
                    cur.executemany(
                        """INSERT INTO raw_landing.hh_vacancies
                             (source_id, country, dt, kind, payload)
                           VALUES (%s, %s, %s, %s, %s)
                           ON CONFLICT (source_id, dt, kind)
                           DO UPDATE SET payload = EXCLUDED.payload,
                                         loaded_at = now()""",
                        rows[i : i + BATCH],
                    )
                counts[kind] += len(rows)

            for key in storage.list_keys(base + "market_counters-"):
                c = storage.read_json(key)
                if not c:
                    continue
                cur.execute(
                    """INSERT INTO raw_landing.market_counters
                         (dt, country, vacancies_total, vacancies_it, it_share, by_role)
                       VALUES (%s, %s, %s, %s, %s, %s)
                       ON CONFLICT (dt, country) DO UPDATE SET
                         vacancies_total = EXCLUDED.vacancies_total,
                         vacancies_it    = EXCLUDED.vacancies_it,
                         it_share        = EXCLUDED.it_share,
                         by_role         = EXCLUDED.by_role""",
                    (dt, country, c["vacancies_total"], c["vacancies_it"],
                     c.get("it_share"), Jsonb(c.get("by_role") or {})),
                )
                counts["counters"] += 1
    return counts


def load_telegram(conn: psycopg.Connection, storage: RawStorage, dt: str) -> int:
    total = 0
    with conn.cursor() as cur:
        for key in storage.list_keys("raw/telegram/"):
            if f"dt={dt}/" not in key:
                continue
            rows = [
                (p["channel"], p["message_id"], dt, p.get("country"), Jsonb(p))
                for p in (storage.read_json(key) or [])
                if p.get("message_id")
            ]
            for i in range(0, len(rows), BATCH):
                cur.executemany(
                    """INSERT INTO raw_landing.telegram_posts
                         (channel, message_id, dt, country, payload)
                       VALUES (%s, %s, %s, %s, %s)
                       ON CONFLICT (channel, message_id)
                       DO UPDATE SET payload = EXCLUDED.payload, loaded_at = now()""",
                    rows[i : i + BATCH],
                )
            total += len(rows)
    return total


def load_rates(conn: psycopg.Connection, storage: RawStorage, dt: str) -> int:
    payload = storage.read_json(f"raw/currency/dt={dt}/rates-000.json.gz")
    if not payload:
        return 0
    sources = payload.get("sources", {})
    rows = [
        (dt, code, rate, sources.get(code))
        for code, rate in payload["rates"].items()
        if len(code) == 3
    ]
    with conn.cursor() as cur:
        cur.executemany(
            """INSERT INTO raw_landing.currency_rates (dt, currency, rate, source)
               VALUES (%s, %s, %s, %s)
               ON CONFLICT (dt, currency)
               DO UPDATE SET rate = EXCLUDED.rate, source = EXCLUDED.source""",
            rows,
        )
    return len(rows)


def main() -> int:
    parser = argparse.ArgumentParser(description="Talap — загрузка сырья в Postgres")
    parser.add_argument("--dt", action="append", help="конкретные даты")
    parser.add_argument("--full", action="store_true", help="перезалить все даты")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s | %(message)s",
    )
    for noisy in ("botocore", "boto3", "urllib3", "s3transfer"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    storage = RawStorage(S3Config.from_env())
    pg = PostgresConfig.from_env()

    with psycopg.connect(pg.dsn, autocommit=False) as conn:
        apply_schema(conn)
        log.info("схемы и таблицы на месте")

        available = sorted(_dates_in_bucket(storage, "raw/"))
        if args.dt:
            dates = args.dt
        elif args.full:
            dates = available
        else:
            dates = sorted(_pending(conn, storage))

        if not dates:
            log.info("новых дат нет, всё загружено")
            return 0

        for dt in dates:
            hh = load_hh(conn, storage, dt)
            tg = load_telegram(conn, storage, dt)
            fx = load_rates(conn, storage, dt)
            conn.commit()
            log.info(
                "%s: hh списков %d, деталей %d, счётчиков %d | телеграм %d | курсов %d",
                dt, hh["list"], hh["details"], hh["counters"], tg, fx,
            )

    return 0


if __name__ == "__main__":
    sys.exit(main())
