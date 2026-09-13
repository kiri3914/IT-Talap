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
import statistics
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from enrichment.grade import detect as detect_grade  # noqa: E402
from enrichment.vacancy import (  # noqa: E402
    ad_key,
    is_monthly,
    is_relocation,
    looks_like_field_work,
    posting_city,
    work_city,
)
from ingestion.config import S3Config  # noqa: E402
from ingestion.storage.s3 import RawStorage  # noqa: E402
from scripts._data import available_dates, coverage, load_active  # noqa: E402

MIN_COUNT = 5  # ТЗ §5.4: ниже — статистически бессмысленно

# Крупные города показываем отдельно, остальные сворачиваем: по стране целиком
# порог проходит 21% групп, внутри одного крупного города — 65% (findings-01)
MAJOR_CITIES = {"Алматы", "Астана", "Ташкент", "Бишкек"}
COUNTRY_NAMES = {"kz": "Казахстана", "uz": "Узбекистана", "kg": "Кыргызстана"}



def grade_of(v: dict) -> str:
    """Грейд — дополнительная ось (ТЗ §5.4). Правила общие с телеграмом."""
    grade, _ = detect_grade(v.get("name"), v.get("description"))
    return grade or "—"




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
    parser.add_argument("--keep-copies", action="store_true",
                        help="не схлопывать мультигородские копии (завышает спрос на ~4%%)")
    parser.add_argument("--keep-relocation", action="store_true",
                        help="оставить релокационные вакансии (перекашивают медиану)")
    parser.add_argument("--by-posting-city", action="store_true",
                        help="считать по городу раздела, а не по месту работы")
    parser.add_argument("--usd", action="store_true",
                        help="пересчитать в USD по курсу на дату (сравнение стран)")
    parser.add_argument("--mix-gross", action="store_true",
                        help="не разделять gross и net (даёт смешанную, некорректную медиану)")
    args = parser.parse_args()

    storage = RawStorage(S3Config.from_env())
    dates = available_dates(storage)
    if not dates:
        print("в бакете пусто")
        return 1
    dt = args.dt or dates[-1]

    vacancies = load_active(storage, dt)
    total, with_details = coverage(storage, dt)
    print(f"дата: {dt}, активных вакансий: {total}, из них с деталями: {with_details}")
    if with_details < total:
        print(f"  ⚠ без деталей: {total - with_details} — "
              f"появились до первой полной загрузки")

    fx: dict[str, float] = {}
    if args.usd:
        payload = storage.read_json(f"raw/currency/dt={dt}/rates-000.json.gz")
        if not payload:
            print(f"\nнет курсов за {dt}. Соберите их отдельно:")
            print(f"  python -m ingestion.backfill_rates --dt {dt}")
            return 1
        fx = payload["rates"]
        args.currency = "USD"
        print("курсы: " + ", ".join(f"{c}={v:.4g}" for c, v in sorted(fx.items())
                                    if c in ("KZT", "UZS", "KGS")))

    # Оставляем только с зарплатой в выбранной валюте и месячной ставкой
    rows = []
    skipped_mode = 0
    for v in vacancies:
        if not is_monthly(v):
            skipped_mode += 1
            continue
        sal = v.get("salary") or v.get("salary_range")
        if not isinstance(sal, dict):
            continue
        cur = sal.get("currency")
        value = point_estimate(sal)
        if not value or not cur:
            continue
        if fx:
            if cur not in fx:
                continue  # курса нет — вакансию не считаем, а не выдумываем курс
            value /= fx[cur]
        elif cur != args.currency:
            continue
        city_raw = (
            posting_city(v) if args.by_posting_city else work_city(v)
        ) or "—"
        city = (
            city_raw if city_raw in MAJOR_CITIES
            else f"прочие города {COUNTRY_NAMES.get(v.get('_country'), '')}".strip()
        )
        if args.city and city_raw != args.city:
            continue
        rows.append({
            "ad": ad_key(v),
            "relocation": is_relocation(v),
            "field_work": looks_like_field_work(v),
            "value": value,
            "city": city,
            "role": (v.get("professional_roles") or [{}])[0].get("name") or "—",
            "grade": grade_of(v),
            "exp": (v.get("experience") or {}).get("name") or "—",
            "gross": sal.get("gross"),
        })

    # Релокация: area = Астана, address.city = Лимасол при EUR 7000.
    # Одна такая вакансия в группе из пяти делает медиану бессмысленной.
    relocations = sum(1 for r in rows if r["relocation"])
    if not args.keep_relocation and relocations:
        rows = [r for r in rows if not r["relocation"]]

    # Мультигородские копии: одно объявление в девяти городах считается
    # девятью вакансиями. Оставляем по одной на объявление — кроме тех,
    # что похожи на настоящий региональный найм (findings-04).
    collapsed = 0
    if not args.keep_copies:
        seen: set[str] = set()
        kept = []
        for r in rows:
            if r["field_work"] or r["ad"] not in seen:
                seen.add(r["ad"])
                kept.append(r)
            else:
                collapsed += 1
        rows = kept

    if not rows:
        print(f"нет вакансий с зарплатой в {args.currency}")
        return 1

    print(f"с зарплатой в {args.currency}: {len(rows)}")
    if skipped_mode:
        print(f"  отброшено не-месячных ставок: {skipped_mode} "
              f"(за смену, за услугу, почасовые, вахта)")
    if relocations and not args.keep_relocation:
        print(f"  отброшено релокационных: {relocations} "
              f"(место работы вне города публикации)")
    if collapsed:
        print(f"  схлопнуто копий одного объявления: {collapsed}")
    print(f"  итого в расчёте: {len(rows)}")
    gross = sum(1 for r in rows if r["gross"] is True)
    net = sum(1 for r in rows if r["gross"] is False)
    print(f"  до вычета налогов: {gross}, на руки: {net}, не указано: {len(rows) - gross - net}")
    print("\n⚠ Это ЗАЯВЛЕННЫЕ вилки из объявлений, а не зарплаты нанятых.")
    print("  Середина вилки берётся как одна точка на вакансию.")

    if not args.mix_gross:
        groups_gross = {True: "до вычета налогов", False: "на руки", None: "не указано"}
        for flag, label in groups_gross.items():
            subset = [r for r in rows if r["gross"] is flag]
            if len(subset) < args.min_count:
                continue
            header = f"# {label.upper()}  ({len(subset)} вакансий)"
            print(f"\n{'#' * 88}\n{header}\n{'#' * 88}")
            _render(subset, args)
        print(f"\n{'=' * 88}")
        print("gross и net считаются отдельно: разница около 10%, смешивать их")
        print("значит получить величину, не означающую ничего. --mix-gross снимает разделение.")
        return 0

    _render(rows, args)
    return 0


def _render(rows: list[dict], args) -> None:
    by_role = defaultdict(list)
    by_city = defaultdict(list)
    by_role_city = defaultdict(list)
    by_exp = defaultdict(list)
    by_grade = defaultdict(list)
    by_role_exp_city = defaultdict(list)
    for r in rows:
        by_role[r["role"]].append(r["value"])
        by_city[r["city"]].append(r["value"])
        by_role_city[(r["role"], r["city"])].append(r["value"])
        by_exp[r["exp"]].append(r["value"])
        by_role_exp_city[(r["role"], r["exp"], r["city"])].append(r["value"])
        if r["grade"] != "—":
            by_grade[r["grade"]].append(r["value"])

    # Опыт — основная ось (ТЗ §5.4): приходит из источника, заполнен у 100%
    report("ПО ОПЫТУ", by_exp, args.min_count, args.currency)
    report("ПО ПРОФЕССИЯМ", by_role, args.min_count, args.currency)
    report("ПО ГОРОДАМ", by_city, args.min_count, args.currency)
    report("ПРОФЕССИЯ × ГОРОД", by_role_city, args.min_count, args.currency)
    report("ПРОФЕССИЯ × ОПЫТ × ГОРОД  — гранулярность mart_salary_stats",
           by_role_exp_city, args.min_count, args.currency)
    # Грейд — дополнительная ось: распознаётся правилами у 16% и даёт
    # противоречивые результаты на малых выборках (findings-01)
    report("ПО ГРЕЙДУ (дополнительно, распознан у части)", by_grade,
           args.min_count, args.currency)

    for label, groups in (
        ("профессия × город", by_role_city),
        ("профессия × опыт × город", by_role_exp_city),
    ):
        total = len(groups)
        passed = sum(1 for v in groups.values() if len(v) >= args.min_count)
        if total:
            print(f"  наполняемость {label:26} {passed:4} из {total:4} "
                  f"({100 * passed / total:3.0f}%)")


if __name__ == "__main__":
    sys.exit(main())
