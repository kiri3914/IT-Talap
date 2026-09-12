"""Тесты распознавания грейда."""

from __future__ import annotations

import pytest

from enrichment.grade import detect, grade_from_text, grade_from_years


@pytest.mark.parametrize("title,expected", [
    ("Senior Python Developer", "senior"),
    ("Старший разработчик", "senior"),
    ("Ведущий инженер", "senior"),
    ("Junior QA", "junior"),
    ("Младший аналитик", "junior"),
    ("Стажёр-разработчик", "junior"),
    ("Middle Frontend", "middle"),
    ("Team Lead", "lead"),
    ("Тимлид команды разработки", "lead"),
    ("Руководитель группы разработки", "lead"),
    ("Программист 1С", None),
    ("Системный администратор", None),
])
def test_грейд_из_текста(title, expected):
    assert grade_from_text(title) == expected


def test_lead_важнее_senior():
    """Порядок правил значим: у «Senior Team Lead» грейд lead."""
    assert grade_from_text("Senior Team Lead") == "lead"


@pytest.mark.parametrize("text,expected", [
    ("опыт коммерческой разработки от 5 лет", "senior"),
    ("Опыт работы от 1 года", "junior"),
    ("3+ лет коммерческого опыта с Python", "middle"),
    ("опыт от 8 лет", "lead"),
])
def test_грейд_из_стажа(text, expected):
    assert grade_from_years(text) == expected


def test_нереальный_стаж_отбрасывается():
    assert grade_from_years("опыт от 99 лет") is None


def test_способ_получения_возвращается():
    """Грейд из заголовка надёжнее выведенного по стажу — в витринах
    их надо уметь различать."""
    assert detect("Senior Developer", None) == ("senior", "title")
    assert detect("Разработчик", "Senior уровень") == ("senior", "description")
    assert detect("Разработчик", "опыт от 5 лет") == ("senior", "years")
    assert detect("Разработчик", "интересная работа") == (None, "none")


def test_пустые_входные_данные():
    assert detect(None, None) == (None, "none")
    assert grade_from_text("") is None
