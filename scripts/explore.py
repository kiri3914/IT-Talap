"""Первый взгляд на собранные данные.

Считает семь цифр из docs/data_notes.md прямо по сырью в бакете.
Ничего не пишет — только читает и печатает.

    .venv/bin/python scripts/explore.py                 # последняя дата, все страны
    .venv/bin/python scripts/explore.py --country kz
    .venv/bin/python scripts/explore.py --dt 2026-09-11
"""

from __future__ import annotations

import argparse
import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ingestion.config import S3Config  # noqa: E402
from ingestion.storage.s3 import RawStorage  # noqa: E402

EXPERIENCE_LABELS = {
    "noExperience": "без опыта",
    "between1And3": "1–3 года",
    "between3And6": "3–6 лет",
    "moreThan6": "более 6 лет",
}

GRADE_PATTERNS = [
    ("junior", r"\b(junior|jun|джуниор|младш|стажер|стажёр|intern|trainee)\b"),
    ("senior", r"\b(senior|sen|синьор|сеньор|старш|ведущ)\b"),
    ("lead", r"\b(lead|тимлид|team\s*lead|руководител|head\s+of)\b"),
    ("middle", r"\b(middle|mid|мидл)\b"),
]


def pct(part: int, total: int) -> str:
    return f"{100 * part / total:5.1f}%" if total else "    —"


def bar(value: int, total: int, width: int = 28) -> str:
    filled = round(width * value / total) if total else 0
    return "█" * filled + "·" * (width - filled)


def load_details(storage: RawStorage, country: str, dt: str) -> list[dict]:
    prefix = f"raw/hh/country={country}/dt={dt}/vacancy_details-"
    out: list[dict] = []
    for key in sorted(storage.list_keys(prefix)):
        out.extend(storage.read_json(key) or [])
    return out


def salary_of(v: dict) -> dict | None:
    """У hh два поля зарплаты, оба могут быть null (см. docs/data_notes.md §2)."""
    raw = v.get("salary") or v.get("salary_range")
    return raw if isinstance(raw, dict) else None


def guess_grade(title: str) -> str:
    low = title.lower()
    for grade, pattern in GRADE_PATTERNS:
        if re.search(pattern, low):
            return grade
    return "не распознан"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--country", action="append")
    parser.add_argument("--dt")
    args = parser.parse_args()

    storage = RawStorage(S3Config.from_env())

    dates = sorted({m.group(1) for k in storage.list_keys("raw/hh/")
                    if (m := re.search(r"dt=([\d-]+)", k))})
    if not dates:
        print("в бакете пусто")
        return 1
    dt = args.dt or dates[-1]
    countries = args.country or ["kz", "uz", "kg"]

    vacancies: list[dict] = []
    print(f"дата: {dt}\n")
    for country in countries:
        part = load_details(storage, country, dt)
        if part:
            for v in part:
                v["_country"] = country
            vacancies.extend(part)
            print(f"  {country}: {len(part)} вакансий")
    if not vacancies:
        print("нет данных за эту дату")
        return 1

    total = len(vacancies)
    print(f"\nвсего: {total}\n" + "=" * 62)

    # 1. Зарплаты
    with_sal = [v for v in vacancies if salary_of(v)]
    only_range = [v for v in vacancies if not v.get("salary") and v.get("salary_range")]
    print("\n1. ЗАРПЛАТА")
    print(f"   указана:                {len(with_sal):5}  {pct(len(with_sal), total)}")
    print(f"   только в salary_range:  {len(only_range):5}  {pct(len(only_range), total)}")
    both = sum(1 for v in with_sal if (s := salary_of(v)) and s.get("from") and s.get("to"))
    only_from = sum(1 for v in with_sal if (s := salary_of(v)) and s.get("from") and not s.get("to"))
    print(f"   полная вилка (от и до): {both:5}  {pct(both, total)}")
    print(f"   только «от»:            {only_from:5}  {pct(only_from, total)}")

    # 2. Валюты
    currencies = Counter(
        s.get("currency") for v in with_sal if (s := salary_of(v)) and s.get("currency")
    )
    print("\n2. ВАЛЮТЫ (среди вакансий с зарплатой)")
    for cur, n in currencies.most_common():
        print(f"   {cur or '—':5} {n:5}  {pct(n, len(with_sal))}  {bar(n, len(with_sal))}")

    # 3. Опыт
    print("\n3. ОПЫТ")
    exp = Counter((v.get("experience") or {}).get("id") for v in vacancies)
    for key, label in EXPERIENCE_LABELS.items():
        n = exp.get(key, 0)
        print(f"   {label:14} {n:5}  {pct(n, total)}  {bar(n, total)}")

    # 4. Грейд по заголовку — оценка сверху для Фазы 2
    print("\n4. ГРЕЙД ИЗ ЗАГОЛОВКА (правилами, без LLM)")
    grades = Counter(guess_grade(v.get("name") or "") for v in vacancies)
    for grade, n in grades.most_common():
        print(f"   {grade:14} {n:5}  {pct(n, total)}  {bar(n, total)}")
    unknown = grades.get("не распознан", 0)
    print(f"\n   → правила покрывают {pct(total - unknown, total).strip()} заголовков")

    # 5. Скиллы
    print("\n5. СКИЛЛЫ")
    with_skills = [v for v in vacancies if v.get("key_skills")]
    print(f"   заполнены: {len(with_skills)}  {pct(len(with_skills), total)}")
    skills = Counter(s["name"] for v in with_skills for s in v["key_skills"] if s.get("name"))
    print(f"   уникальных: {len(skills)}")
    print("   топ-15:")
    for name, n in skills.most_common(15):
        print(f"      {name[:34]:34} {n:5}  {pct(n, total)}")

    # 6. Работодатели
    print("\n6. РАБОТОДАТЕЛИ")
    employers = Counter(
        (e.get("id"), e.get("name")) for v in vacancies if (e := v.get("employer")) and e.get("id")
    )
    print(f"   уникальных: {len(employers)}")
    top10 = sum(n for _, n in employers.most_common(10))
    print(f"   доля топ-10: {pct(top10, total)}")
    print("   топ-10:")
    for (_, name), n in employers.most_common(10):
        print(f"      {(name or '?')[:34]:34} {n:5}  {pct(n, total)}")

    # 7. Архив и профессии
    print("\n7. ПРОЧЕЕ")
    archived = sum(1 for v in vacancies if v.get("archived"))
    print(f"   archived=true:   {archived:5}  {pct(archived, total)}")
    roles = Counter(
        r.get("name") for v in vacancies for r in (v.get("professional_roles") or [])
    )
    print(f"   проф. ролей:     {len(roles)}")
    print("   топ-10 ролей:")
    for name, n in roles.most_common(10):
        print(f"      {(name or '?')[:34]:34} {n:5}  {pct(n, total)}")

    cities = Counter((v.get("area") or {}).get("name") for v in vacancies)
    print("\n   топ-10 городов:")
    for name, n in cities.most_common(10):
        print(f"      {(name or '?')[:34]:34} {n:5}  {pct(n, total)}")

    print("\n" + "=" * 62)
    print("Порог публикации из ТЗ §5.4 — 5 наблюдений на группу.")
    print("Смотрите на долю с зарплатой: это и есть выборка для зарплатной статистики.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
