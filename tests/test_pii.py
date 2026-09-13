"""Тесты распознавания персональных данных.

Первая версия считала ФИО любые два слова с заглавных букв и дала 116
«имён», среди которых были компании вроде «Аква Строй». Признак должен
быть содержательным — отчество или явный статус физлица, — а не
типографским.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

from audit_pii import PERSON_EMPLOYER, mask  # noqa: E402


@pytest.mark.parametrize("name", [
    "МУСАЕВА УЛПАШ ИСАЕВНА",
    "Мусаева Улпаш Исаевна",
    "ИП Иванов И.И.",
    "ИП Захаров",
    "Иванов И. И.",
    "Асан Серикулы",
    "Айгуль Нурлановна",
    "Азиза Рахимкызы",
])
def test_фио_физлица(name):
    assert PERSON_EMPLOYER.search(name), f"не распознано как ФИО: {name}"


@pytest.mark.parametrize("name", [
    "Аква Строй",
    "Алматы Строй",
    "Kaspi.kz",
    "ТОО Digital Alliance",
    "Лига Цифровой Экономики",
    "Freedom Bank Kazakhstan",
    "Инфинити Орда",
    "Банк ЦентрКредит",
])
def test_названия_компаний_не_фио(name):
    assert not PERSON_EMPLOYER.search(name), f"компания принята за ФИО: {name}"


class TestМаскирование:
    """Вывод аудита показывают и хранят — значения не должны восстанавливаться."""

    def test_почта(self):
        got = mask("anna.petrova@company.kz", "email")
        assert "petrova" not in got and "company" not in got
        assert got.startswith("an") and "@" in got

    def test_телефон(self):
        got = mask("+7 707 123 45 67", "phone")
        assert "70712345" not in got.replace("…", "")
        assert "11 цифр" in got

    def test_имя(self):
        got = mask("МУСАЕВА УЛПАШ ИСАЕВНА", "person")
        assert "УСАЕВА" not in got
        assert got.startswith("М")

    def test_телеграм(self):
        got = mask("@recruiter_kz", "telegram")
        assert "cruiter" not in got
