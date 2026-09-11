"""Зарплатный отчёт по собранным данным.

Первая продуктовая метрика: сколько предлагают по профессиям и городам.

Считает в валюте оригинала — курсов у нас пока нет, а пересчёт по выдуманному
курсу хуже, чем его отсутствие. Группы меньше порога (ТЗ §5.4) не показываются.

    .venv/bin/python scripts/salary_report.py
    .venv/bin/python scripts/salary_report.py --city Алматы
    .venv/bin/python scripts/salary_report.py --min-count 10
"""

from __future__ import annotations

import argparse
import re
import statistics
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ingestion.config import S3Config  # noqa: E402
from ingestion.storage.s3 import RawStorage  # noqa: E402

MIN_COUNT = 5  # ТЗ §5.4: ниже — статистически бессмысленно

GRADE_PATTERNS = [
    ("lead", r"(team\s*lead|tech\s*lead|тимлид|тим\s*лид|руководител|head\s+of|начальник)"),
    ("senior", r"(senior|сеньор|синьор|старший|ведущий|sr\b)"),
    ("junior", r"(junior|джуниор|джун|младший|стажёр|стажер|intern|trainee|начинающий)"),
    ("middle", r"(middle|мидл|mid\b)"),
]


def load(storage: RawStorage, dt: str) -> list[dict]:
    out = []
    for country in ("kz", "uz", "kg"):
        prefix = f"raw/hh/country={country}/dt={dt}/vacancy_details-"
        for key in sorted(storage.list_keys(prefix)):
            for v in storage.read_json(key) or []:
                v["_country"] = country
                out.append(v)
    return out


def grade_of(v: dict) -> str:
    text = (v.get("name") or "").lower()
    for grade, pattern in GRADE_PATTERNS:
        if re.search(pattern, text):
            return grade
    return "—"


def point_estimate(sal: dict) -> float | None:
    """Одно число на вакансию: середина вилки, либо доступная граница."""
    lo, hi = sal.get("from"), sal.get("to")
    if lo and hi:
        return (lo + hi) / 2
    return float(lo or hi) if (lo or hi) else None


def fmt(value: float) -> str:
    return f"{value:,.0f}".replace(",", " ")


def stats_line(values: list[float]) -> str:
    values = sorted(values)
    p25 = statistics.quantiles(values, n=4)[0] if len(values) >= 4 else values[0]
    p75 = statistics.quantiles(values, n=4)[2] if len(values) >= 4 else values[-1]
    return (
        f"{len(values):>5}  {fmt(p25):>12}  {fmt(statistics.median(values)):>12}  "
        f"{fmt(p75):>12}"
    )


def report(title: str, groups: dict, min_count: int, currency: str) -> None:
    shown = {k: v for k, v in groups.items() if len(v) >= min_count}
    hidden = len(groups) - len(shown)
    print(f"\n{title}  ({currency})")
    print(f"{'':38} {'N':>5}  {'p25':>12}  {'медиана':>12}  {'p75':>12}")
    print("-" * 88)
    for key, values in sorted(shown.items(), key=lambda kv: -statistics.median(kv[1])):
        label = key if isinstance(key, str) else " · ".join(str(p) for p in key)
        print(f"{label[:38]:38} {stats_line(values)}")
    if hidden:
        print(f"\n  скрыто групп ниже порога {min_count}: {hidden}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dt")
    parser.add_argument("--city")
    parser.add_argument("--currency", default="KZT")
    parser.add_argument("--min-count", type=int, default=MIN_COUNT)
    args = parser.parse_args()

    storage = RawStorage(S3Config.from_env())
    dates = sorted({m.group(1) for k in storage.list_keys("raw/hh/")
                    if (m := re.search(r"dt=([\d-]+)", k))})
    if not dates:
        print("в бакете пусто")
        return 1
    dt = args.dt or dates[-1]

    vacancies = load(storage, dt)
    print(f"дата: {dt}, всего вакансий: {len(vacancies)}")

    # Оставляем только с зарплатой в выбранной валюте
    rows = []
    for v in vacancies:
        sal = v.get("salary") or v.get("salary_range")
        if not isinstance(sal, dict) or sal.get("currency") != args.currency:
            continue
        value = point_estimate(sal)
        if not value:
            continue
        city = (v.get("area") or {}).get("name") or "—"
        if args.city and city != args.city:
            continue
        rows.append({
            "value": value,
            "city": city,
            "role": (v.get("professional_roles") or [{}])[0].get("name") or "—",
            "grade": grade_of(v),
            "exp": (v.get("experience") or {}).get("name") or "—",
            "gross": sal.get("gross"),
        })

    if not rows:
        print(f"нет вакансий с зарплатой в {args.currency}")
        return 1

    print(f"с зарплатой в {args.currency}: {len(rows)}")
    gross = sum(1 for r in rows if r["gross"] is True)
    net = sum(1 for r in rows if r["gross"] is False)
    print(f"  до вычета налогов: {gross}, на руки: {net}, не указано: {len(rows) - gross - net}")
    print("\n⚠ Это ЗАЯВЛЕННЫЕ вилки из объявлений, а не зарплаты нанятых.")
    print("  Середина вилки берётся как одна точка на вакансию.")

    by_role = defaultdict(list)
    by_city = defaultdict(list)
    by_role_city = defaultdict(list)
    by_exp = defaultdict(list)
    by_grade = defaultdict(list)
    for r in rows:
        by_role[r["role"]].append(r["value"])
        by_city[r["city"]].append(r["value"])
        by_role_city[(r["role"], r["city"])].append(r["value"])
        by_exp[r["exp"]].append(r["value"])
        if r["grade"] != "—":
            by_grade[r["grade"]].append(r["value"])

    report("ПО ПРОФЕССИЯМ", by_role, args.min_count, args.currency)
    report("ПО ГОРОДАМ", by_city, args.min_count, args.currency)
    report("ПО ОПЫТУ", by_exp, args.min_count, args.currency)
    report("ПО ГРЕЙДУ (распознан у части вакансий)", by_grade, args.min_count, args.currency)
    report("ПРОФЕССИЯ × ГОРОД", by_role_city, args.min_count, args.currency)

    total_groups = len(by_role_city)
    passed = sum(1 for v in by_role_city.values() if len(v) >= args.min_count)
    print(f"\n{'=' * 88}")
    print(f"Профессия × город: {passed} из {total_groups} групп прошли порог "
          f"({100 * passed / total_groups:.0f}%)")
    print("Это и есть ответ на вопрос, какая гранулярность витрин реально наполнится.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
