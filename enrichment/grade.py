"""Распознавание грейда из заголовка и описания вакансии.

По ТЗ §5.4 грейд — ДОПОЛНИТЕЛЬНАЯ ось витрин, основная это `experience`
из источника. Причина: на данных 2026-09-11 правила по заголовку покрыли
16% вакансий, а полученные медианы противоречили друг другу в трёх странах.

Здесь правила расширены и применяются не только к заголовку, но и к тексту.
Порядок проверки важен: lead перед senior (у «Senior Team Lead» грейд lead),
затем junior, затем middle, затем вывод из стажа.
"""

from __future__ import annotations

import re

GRADES = ("lead", "senior", "middle", "junior")

# Порядок значим: первый сработавший выигрывает
_TITLE_RULES: list[tuple[str, str]] = [
    ("lead", r"(team\s*lead|tech\s*lead|техлид|тимлид|тим[\s-]?лид|"
             r"руководител\w*\s+(группы|команды|отдела|направления)|"
             r"head\s+of|начальник\s+отдела|principal|staff\s+engineer)"),
    ("senior", r"(\bsenior\b|\bsr\.?\b|сеньор|синьор|старший|ведущий)"),
    ("junior", r"(\bjunior\b|\bjr\.?\b|джуниор|\bджун\b|младший|"
               r"стаж[её]р|intern\b|trainee|начинающий|\bentry\b)"),
    ("middle", r"(\bmiddle\b|\bmid\b|\bмидл\b|средний\s+уровень)"),
]
_COMPILED = [(g, re.compile(p, re.I)) for g, p in _TITLE_RULES]

# «от 5 лет опыта» — если грейд не назван, стаж даёт приближение
_YEARS = re.compile(
    r"(?:опыт\w*|experience|стаж)[^.\n]{0,40}?(?:от\s*)?(\d{1,2})\s*(?:\+\s*)?"
    r"(?:лет|год\w*|years?)|(?:от\s*)?(\d{1,2})\s*(?:\+\s*)?(?:лет|год\w*|years?)"
    r"[^.\n]{0,20}?(?:опыт\w*|коммерческ\w*)",
    re.I,
)
_YEARS_TO_GRADE = ((6, "lead"), (4, "senior"), (2, "middle"), (0, "junior"))


def grade_from_text(text: str | None) -> str | None:
    """Явно названный грейд. None, если не назван."""
    if not text:
        return None
    for grade, pattern in _COMPILED:
        if pattern.search(text):
            return grade
    return None


def grade_from_years(text: str | None) -> str | None:
    """Приближение по требуемому стажу. Слабее явного упоминания."""
    if not text:
        return None
    m = _YEARS.search(text)
    if not m:
        return None
    years = int(m.group(1) or m.group(2) or 0)
    if years > 20:  # почти наверняка не стаж
        return None
    for threshold, grade in _YEARS_TO_GRADE:
        if years >= threshold:
            return grade
    return None


def detect(title: str | None = None, description: str | None = None) -> tuple[str | None, str]:
    """Грейд и способ, которым он получен.

    Способ важнее, чем кажется: грейд из заголовка надёжнее, чем выведенный
    из стажа, и в витринах их стоит уметь различать.
    """
    if grade := grade_from_text(title):
        return grade, "title"
    if grade := grade_from_text(description):
        return grade, "description"
    if grade := grade_from_years(description or title):
        return grade, "years"
    return None, "none"
