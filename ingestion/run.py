"""Точка входа: сбор вакансий hh за дату.

Порядок обязателен (ТЗ §3.3):

    fetch -> write_raw -> validate -> alert

Сначала сырьё в бакет, потом валидация. Валидация — сигнал для нас,
а не шлагбаум для данных: упавшая проверка не должна стоить дня истории.

Запуск:
    python -m ingestion.run                       # все страны, сегодня
    python -m ingestion.run --country kz          # одна страна
    python -m ingestion.run --dt 2026-09-04       # бэкфилл партиции
    python -m ingestion.run --skip-details        # только списки, без деталей
"""

from __future__ import annotations

import argparse
import logging
import sys
import time
from datetime import date, datetime, timedelta, timezone

from ingestion.alerts import send as send_alert
from ingestion.config import AlertConfig, HHConfig, S3Config
from ingestion.schemas.hh import check_list_items
from ingestion.sources.hh import COUNTRIES, HHClient, today
from ingestion.storage.s3 import RawStorage

log = logging.getLogger("talap.ingest")

SOURCE = "hh"
CHUNK_SIZE = 500
# Предохранитель: если дельта аномально велика, вероятно, вчерашняя партиция битая.
MAX_DETAILS_PER_RUN = 8000


def _chunks(items: list, size: int) -> list[list]:
    return [items[i : i + size] for i in range(0, len(items), size)]


def _previous_ids(storage: RawStorage, country: str, dt: str) -> set[str]:
    """ID из вчерашней партиции — основа дельты для загрузки деталей."""
    prev_dt = (date.fromisoformat(dt) - timedelta(days=1)).isoformat()
    prefix = f"raw/{SOURCE}/country={country}/dt={prev_dt}/vacancies_list-"
    ids: set[str] = set()
    for key in storage.list_keys(prefix):
        payload = storage.read_json(key) or []
        ids |= {str(item.get("id")) for item in payload if item.get("id")}
    log.info("%s: во вчерашней партиции %d id", country, len(ids))
    return ids


def ingest_country(
    country: str,
    dt: str,
    storage: RawStorage,
    hh_cfg: HHConfig,
    alerts: AlertConfig,
    skip_details: bool,
) -> dict:
    started = time.monotonic()
    partition = f"raw/{SOURCE}/country={country}/dt={dt}/"
    result = {"country": country, "dt": dt, "status": "failed", "list": 0, "details": 0}

    with HHClient(hh_cfg) as client:
        # 0. Счётчики рынка — пишем ПЕРВЫМИ: дёшево и невосстановимо.
        # Даже если сбор дальше упадёт, срез рынка за этот день сохранится.
        try:
            counters = client.fetch_counters(country)
            counters["dt"] = dt
            counters["collected_at"] = datetime.now(timezone.utc).isoformat()
            storage.write_json(
                RawStorage.key(SOURCE, country, dt, "market_counters", 0), counters
            )
            result["total"] = counters["vacancies_total"]
            result["it_share"] = counters["it_share"]
        except Exception as exc:  # noqa: BLE001 — счётчики не должны блокировать сбор
            log.warning("%s: счётчики не собрались: %s", country, exc)

        # 1. FETCH
        items = client.fetch_country_list(country)

        # 2. WRITE RAW — до всякой валидации
        # Идемпотентность: чистим только списки, счётчики не трогаем.
        # Очистка всей партиции стёрла бы market_counters, записанные выше.
        storage.delete_prefix(f"{partition}vacancies_list-")
        for part, chunk in enumerate(_chunks(items, CHUNK_SIZE)):
            storage.write_json(
                RawStorage.key(SOURCE, country, dt, "vacancies_list", part), chunk
            )
        result["list"] = len(items)
        log.info("%s: списки записаны (%d вакансий)", country, len(items))

        # 3. Детали — только по дельте (ТЗ §3.2)
        if not skip_details:
            current_ids = {str(i["id"]) for i in items if i.get("id")}
            new_ids = sorted(current_ids - _previous_ids(storage, country, dt))
            if len(new_ids) > MAX_DETAILS_PER_RUN:
                log.warning(
                    "%s: дельта %d > %d, беру первые — проверить вчерашнюю партицию",
                    country, len(new_ids), MAX_DETAILS_PER_RUN,
                )
                new_ids = new_ids[:MAX_DETAILS_PER_RUN]

            log.info("%s: деталей к загрузке %d", country, len(new_ids))
            details = client.fetch_details(new_ids)
            storage.delete_prefix(f"{partition}vacancy_details-")
            for part, chunk in enumerate(_chunks(details, CHUNK_SIZE)):
                storage.write_json(
                    RawStorage.key(SOURCE, country, dt, "vacancy_details", part), chunk
                )
            result["details"] = len(details)

        result["requests"] = client.stats.requests
        truncated = list(client.stats.truncated_slices)

    # 4. VALIDATE — сигнал, не шлагбаум. Сырьё уже лежит в бакете.
    issues = check_list_items(items)
    if issues:
        lines = "\n".join(f"  • {i.kind}: {i.count} — {i.sample}" for i in issues)
        log.warning("%s: расхождения схемы\n%s", country, lines)
        send_alert(alerts, f"⚠️ Talap / {SOURCE} / {country} {dt}\nСхема:\n{lines}")
    if truncated:
        send_alert(
            alerts,
            f"⚠️ Talap / {SOURCE} / {country} {dt}\n"
            f"Срезы не влезли в глубину выдачи:\n" + "\n".join(f"  • {s}" for s in truncated),
        )
    if not items:
        send_alert(alerts, f"🔴 Talap / {SOURCE} / {country} {dt}: пустая выдача")

    result["status"] = "success"
    result["seconds"] = round(time.monotonic() - started, 1)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Talap — сбор вакансий hh")
    parser.add_argument("--country", choices=sorted(COUNTRIES), action="append")
    parser.add_argument("--dt", default=today(), help="дата партиции YYYY-MM-DD")
    parser.add_argument("--skip-details", action="store_true", help="только списки")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s | %(message)s",
    )
    # Библиотеки логируют каждый HTTP-запрос. При загрузке деталей это тысячи
    # строк за запуск — в cron логи распухнут, а полезные сообщения утонут.
    for noisy in ("httpx", "httpcore", "botocore", "boto3", "urllib3", "s3transfer"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    s3_cfg = S3Config.from_env()
    hh_cfg = HHConfig.from_env()
    alerts = AlertConfig.from_env()
    storage = RawStorage(s3_cfg)

    countries = args.country or sorted(COUNTRIES)
    results: list[dict] = []
    failed = False

    # Отказ одной страны не блокирует остальные (ТЗ §7.1)
    for country in countries:
        try:
            results.append(
                ingest_country(country, args.dt, storage, hh_cfg, alerts, args.skip_details)
            )
        except Exception as exc:  # noqa: BLE001 — падение одной страны не роняет запуск
            failed = True
            log.exception("%s: сбор упал", country)
            results.append({"country": country, "dt": args.dt, "status": "failed", "error": str(exc)})
            send_alert(alerts, f"🔴 Talap / {SOURCE} / {country} {args.dt}\nСбор упал: {exc}")

    log.info("итог: %s", results)
    summary = " | ".join(
        f"{r['country']}: {r.get('list', 0)} вакансий, {r.get('details', 0)} деталей"
        if r["status"] == "success"
        else f"{r['country']}: FAILED"
        for r in results
    )
    log.info("%s %s — %s", SOURCE, args.dt, summary)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
