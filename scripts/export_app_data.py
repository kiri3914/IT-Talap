"""Выгрузка фактов для приложения: вакансии, история по дням, события.

    .venv/bin/python -m scripts.export_app_data --out web/public/data

ВНИМАНИЕ: результат содержит данные по отдельным вакансиям и компаниям.
Его нельзя коммитить и публиковать — условия API hh, пп. 3.11, 4.3, 4.6
(docs/sources/hh.md §5). Каталог вывода в .gitignore.

Это ВРЕМЕННАЯ эталонная реализация истории вакансий. По ТЗ §12.1 core-слой
(снапшоты, SCD2, события) пишется руками в dbt. Когда он появится, выгрузка
переходит на него, а этот код остаётся проверкой: цифры обязаны совпасть.

Принцип: здесь только факты. Срезы (по стране, профессии, компании, дате)
считает приложение — так страницы не расходятся между собой.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import psycopg

from enrichment.profession import guess_profession
from enrichment.telegram_fields import parse_post
from enrichment.vacancy import ad_key, is_monthly, posting_city, salary_of
from ingestion.config import PostgresConfig
from scripts.export_site_data import USD_CEIL, USD_FLOOR, Rates, load_soft_skills, point

ROOT = Path(__file__).resolve().parent.parent
MAJOR_CITIES = {"Алматы", "Астана", "Ташкент", "Бишкек"}
DOMAIN = {"kz": "hh.kz", "uz": "hh.uz", "kg": "hh.kg"}

# ИП и физлица среди работодателей: имя человека. Внутри команды видно,
# в интерфейсе показывается как «частный работодатель».
_PERSON = re.compile(
    r"^(ИП|ЖК|Индивидуальный предприниматель)\b"
    r"|(вич|вна|улы|ұлы|кызы|қызы|оглы)\b"
)

# Типы событий. Порядок — порядок важности в ленте.
OPEN, CLOSE, RETURN, RAISE, SALARY_UP, SALARY_DOWN, SALARY_SET, SALARY_DROP = (
    "open", "close", "return", "raise", "salary_up", "salary_down", "salary_set", "salary_drop")


def city_group(country: str, city: str | None) -> str:
    """Крупные города отдельно, остальные — «прочие города страны» (ТЗ §5.4)."""
    return city if city in MAJOR_CITIES else f"other_{country}"


def salary_key(sal) -> tuple | None:
    if not isinstance(sal, dict) or not (sal.get("from") or sal.get("to")):
        return None
    return (sal.get("from"), sal.get("to"), sal.get("currency"))


def load_professions() -> dict[str, str]:
    with open(ROOT / "dbt/seeds/profession_map.csv", encoding="utf-8") as f:
        return {r["hh_role_id"]: r["profession_code"] for r in csv.DictReader(f)}


def segments(present: list[int]) -> list[list[int]]:
    """Отрезки подряд идущих индексов наблюдённых дней: [[a, b], ...]."""
    out: list[list[int]] = []
    for i in present:
        if out and i == out[-1][1] + 1:
            out[-1][1] = i
        else:
            out.append([i, i])
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", default="web/public/data")
    args = parser.parse_args()
    out_dir = ROOT / args.out
    out_dir.mkdir(parents=True, exist_ok=True)

    prof_by_role = load_professions()
    soft = load_soft_skills()

    with psycopg.connect(PostgresConfig.from_env().dsn) as conn, conn.cursor() as cur:
        cur.execute("""select source_id, country, dt,
                              payload ->> 'published_at',
                              nullif(payload -> 'salary', 'null'::jsonb),
                              nullif(payload -> 'salary_range', 'null'::jsonb)
                       from raw_landing.hh_vacancies where kind = 'list'
                       order by source_id, dt""")
        snapshots = cur.fetchall()

        cur.execute("""select distinct on (source_id) source_id, country, payload
                       from raw_landing.hh_vacancies where kind = 'details'
                       order by source_id, dt desc""")
        details = {(sid, c): p for sid, c, p in cur.fetchall()}

        cur.execute("select dt, currency, rate from raw_landing.currency_rates")
        rates = Rates(cur.fetchall())

        cur.execute("select channel, payload from raw_landing.telegram_posts")
        posts = cur.fetchall()

    # Наблюдённые дни. Пропуски (сервер лежал) в индексацию не входят:
    # «вакансия пропала» значит «не было в выдаче в следующий НАБЛЮДЁННЫЙ день».
    days = sorted({dt for _, _, dt, *_ in snapshots})
    day_ix = {d: i for i, d in enumerate(days)}
    last_ix = len(days) - 1

    by_vac: dict[tuple, list] = defaultdict(list)
    for sid, country, dt, published, sal, rng in snapshots:
        by_vac[(sid, country)].append((day_ix[dt], published, salary_key(sal or rng)))

    vacancies, events, employers = [], [], {}
    for (sid, country), snaps in by_vac.items():
        v = details.get((sid, country))
        if v is None:
            continue
        present = [i for i, *_ in snaps]
        segs = segments(present)

        # --- события по дням --------------------------------------------
        if segs[0][0] > 0:
            events.append([segs[0][0], OPEN, sid])
        for a, b in zip(segs, segs[1:], strict=False):
            events.append([a[1] + 1, CLOSE, sid])
            events.append([b[0], RETURN, sid])
        if segs[-1][1] < last_ix:
            events.append([segs[-1][1] + 1, CLOSE, sid])

        prev = None
        for i, published, sal in snaps:
            if prev is not None:
                _, p_pub, p_sal = prev
                if published and p_pub and published != p_pub:
                    events.append([i, RAISE, sid])
                if sal != p_sal:
                    if p_sal is None:
                        events.append([i, SALARY_SET, sid, None, list(sal)])
                    elif sal is None:
                        events.append([i, SALARY_DROP, sid, list(p_sal), None])
                    else:
                        before = point({"from": p_sal[0], "to": p_sal[1]}) or 0
                        after = point({"from": sal[0], "to": sal[1]}) or 0
                        kind = SALARY_UP if after > before else SALARY_DOWN
                        events.append([i, kind, sid, list(p_sal), list(sal)])
            prev = (i, published, sal)

        # --- карточка -------------------------------------------------------
        role = ((v.get("professional_roles") or [{}])[0] or {}).get("id")
        sal = salary_of(v)
        first_day = days[segs[0][0]]
        usd = None
        if sal and is_monthly(v) and (amount := point(sal)) and sal.get("currency"):
            usd = rates.usd(amount, sal["currency"], first_day)
            if usd is not None and not (USD_FLOOR <= usd <= USD_CEIL):
                usd = None
        emp = v.get("employer") or {}
        if emp.get("id") and emp["id"] not in employers:
            employers[emp["id"]] = {
                "name": emp.get("name"),
                "person": bool(_PERSON.search(emp.get("name") or "")),
                "country": country,
            }
        created_raw = v.get("initial_created_at") or v.get("published_at")
        address = v.get("address") or {}
        skills = [s["name"].strip() for s in (v.get("key_skills") or []) if s.get("name")]
        city = posting_city(v)
        langs = [[lg.get("name"), (lg.get("level") or {}).get("name")]
                 for lg in (v.get("languages") or [])]
        created = datetime.fromisoformat(created_raw).date().isoformat() if created_raw else None
        sal_row = ([sal.get("from"), sal.get("to"), sal.get("currency"), sal.get("gross")]
                   if sal else None)
        vacancies.append({
            "id": sid,
            "c": country,
            "t": v.get("name"),
            "p": prof_by_role.get(str(role)),
            "e": (v.get("experience") or {}).get("id"),
            "f": ((v.get("work_format") or [{}])[0] or {}).get("id"),
            "emp": emp.get("id"),
            "city": city,
            "cg": city_group(country, city),
            "wcity": address.get("city"),
            "sal": sal_row,
            "usd": round(usd) if usd else None,
            "sk": [s for s in skills if s.lower() not in soft],
            "soft": [s for s in skills if s.lower() in soft],
            "lg": langs,
            "test": bool(v.get("has_test")),
            "intern": bool(v.get("internship")),
            "letter": bool(v.get("response_letter_required")),
            "created": created,
            "seg": segs,
            "ad": ad_key(v),
            "lat": address.get("lat"),
            "lng": address.get("lng"),
            # хвост ?tech_source=api — метка API, людям в ссылке не нужна
            "url": (v.get("alternate_url") or f"https://{DOMAIN[country]}/vacancy/{sid}").split("?")[0],
        })

    events.sort(key=lambda e: (e[0], e[1]))

    # Телеграм: без текстов постов — только год, страна, вилка и профессия,
    # распознанная правилами по заголовку (enrichment/profession.py).
    # На вакансиях hh правила узнают 69% заголовков и совпадают с ролью
    # работодателя в 84% случаев.
    telegram = []
    for channel, payload in posts:
        f = parse_post(payload)
        if not f.get("is_vacancy") or not f.get("published_at"):
            continue
        lo, hi = f.get("salary_from"), f.get("salary_to")
        val = (lo + hi) / 2 if lo and hi else (lo or hi)
        telegram.append([int(f["published_at"][:4]), f.get("country"), f.get("currency"),
                         round(val) if val else None, guess_profession(f.get("title")), channel])
    meta = {
        "generated_at": datetime.now().astimezone().isoformat(timespec="minutes"),
        "days": [d.isoformat() for d in days],
        "counts": {"vacancies": len(vacancies), "events": len(events),
                   "employers": len(employers)},
        "private": "Данные по отдельным вакансиям. Не публиковать: "
                   "условия API hh пп. 3.11, 4.3, 4.6.",
    }

    def write(name: str, obj) -> int:
        path = out_dir / name
        text = json.dumps(obj, ensure_ascii=False, separators=(",", ":"), default=str)
        path.write_text(text, encoding="utf-8")
        return len(text)

    sizes = {
        "meta.json": write("meta.json", meta),
        "vacancies.json": write("vacancies.json", vacancies),
        "events.json": write("events.json", events),
        "employers.json": write("employers.json", employers),
        "telegram.json": write("telegram.json", telegram),
    }
    for name, size in sizes.items():
        print(f"{name:16} {size / 1024:8.0f} КБ", file=sys.stderr)
    print(f"дней {len(days)}, вакансий {len(vacancies)}, событий {len(events)}, "
          f"работодателей {len(employers)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
