"""Тесты ключей и нормализации вакансий."""

from __future__ import annotations

import pytest

from enrichment.vacancy import (
    ad_key,
    is_monthly,
    is_relocation,
    looks_like_field_work,
    normalize_title,
    posting_key,
    salary_mode,
    work_city,
)


def v(**kw) -> dict:
    base = {"name": "Разработчик", "employer": {"id": "1"}, "area": {"name": "Алматы"}}
    base.update(kw)
    return base


class TestNormalizeTitle:
    @pytest.mark.parametrize("a,b", [
        ("Python Разработчик", "python  разработчик"),
        ("Python-разработчик!", "python разработчик"),
        ("PYTHON 🚀 Разработчик", "python разработчик"),
    ])
    def test_регистр_пунктуация_эмодзи(self, a, b):
        assert normalize_title(a) == normalize_title(b)

    def test_синонимы(self):
        assert normalize_title("Python разработчик") == normalize_title("Python программист")

    def test_пусто(self):
        assert normalize_title(None) == ""


class TestSalaryMode:
    def test_из_salary_range(self):
        assert salary_mode(v(salary_range={"mode": {"id": "SHIFT"}})) == "SHIFT"

    def test_без_salary_range_считается_месячной(self):
        """Поле появилось позже — у старых записей его нет."""
        assert salary_mode(v(salary={"from": 100})) == "MONTH"
        assert is_monthly(v(salary={"from": 100}))

    def test_без_зарплаты(self):
        assert salary_mode(v()) is None

    def test_не_месячные_отсекаются(self):
        for mode in ("SHIFT", "HOUR", "SERVICE", "FLY_IN_FLY_OUT"):
            assert not is_monthly(v(salary={"from": 1}, salary_range={"mode": {"id": mode}}))


class TestГород:
    def test_релокация_берём_место_работы(self):
        """area = Астана, address.city = Лимасол при EUR 7000 (findings-03)."""
        rel = v(area={"name": "Астана"}, address={"city": "Лимасол"})
        assert work_city(rel) == "Лимасол"
        assert is_relocation(rel)

    def test_без_адреса_берём_раздел(self):
        assert work_city(v()) == "Алматы"
        assert not is_relocation(v())

    def test_совпадают_не_релокация(self):
        assert not is_relocation(v(address={"city": "Алматы"}))


class TestКлючи:
    def test_одно_объявление_разные_города(self):
        """«Специалист по 1С» в девяти городах — одно объявление."""
        a = v(name="Специалист по 1С", salary={"from": 300000, "currency": "KZT"},
              area={"name": "Алматы"})
        b = v(name="Специалист по 1С", salary={"from": 300000, "currency": "KZT"},
              area={"name": "Атырау"})
        assert ad_key(a) == ad_key(b)
        assert posting_key(a) != posting_key(b)

    def test_разные_вилки_разные_объявления(self):
        """У Яндекса вилки отличаются по странам — найм настоящий."""
        a = v(salary={"from": 200000, "currency": "KZT"})
        b = v(salary={"from": 26000, "currency": "KGS"})
        assert ad_key(a) != ad_key(b)

    def test_разные_компании(self):
        assert ad_key(v(employer={"id": "1"})) != ad_key(v(employer={"id": "2"}))

    def test_дубликат_в_одном_городе(self):
        """SQB BOSH BANK: 3 копии в Ташкенте — ключи совпадают полностью."""
        a = v(area={"name": "Ташкент"})
        assert posting_key(a) == posting_key(v(area={"name": "Ташкент"}))


@pytest.mark.parametrize("title,expected", [
    ("Выездной инженер технической поддержки", True),
    ("Инженер в разъездах", True),
    ("Field Engineer", True),
    ("Специалист по 1С", False),
    ("Системный администратор", False),
])
def test_региональный_найм(title, expected):
    assert looks_like_field_work(v(name=title)) is expected


class TestРегрессии:
    """Баги, найденные на живых данных. Каждый закреплён тестом."""

    def test_флорист_с_посменной_оплатой_отсекается(self):
        """В IT-категорию hh попадают вакансии не из IT: работодатель
        выбирает роль наспех. Флористы оказались с режимом SHIFT."""
        florist = v(name="Флорист в цветочный магазин",
                    salary={"from": 18000, "currency": "KZT"},
                    salary_range={"mode": {"id": "SHIFT"}})
        assert not is_monthly(florist)

    def test_проектная_оплата_не_месячная(self):
        """SERVICE — оплата за услугу целиком, суммы несравнимы с окладом."""
        project = v(salary={"from": 10_000_000, "currency": "UZS"},
                    salary_range={"mode": {"id": "SERVICE"}})
        assert not is_monthly(project)

    def test_вахта_не_месячная(self):
        assert not is_monthly(v(salary={"from": 350000},
                                salary_range={"mode": {"id": "FLY_IN_FLY_OUT"}}))

    def test_девять_копий_схлопываются_в_одну(self):
        """«Специалист по 1С», 300 000 KZT, девять городов Казахстана."""
        cities = ["Актобе", "Алматы", "Астана", "Атырау", "Караганда",
                  "Костанай", "Павлодар", "Усть-Каменогорск", "Шымкент"]
        copies = [
            v(name="Специалист по 1С", employer={"id": "777"},
              salary={"from": 300000, "currency": "KZT"}, area={"name": c})
            for c in cities
        ]
        assert len({ad_key(c) for c in copies}) == 1
        assert len({posting_key(c) for c in copies}) == 9

    def test_выездной_инженер_не_схлопывается(self):
        """11 городов, но «выездной» — вероятно, 11 реальных мест."""
        assert looks_like_field_work(
            v(name="Выездной инженер технической поддержки")
        )

    def test_яндекс_разные_страны_разные_объявления(self):
        """Вилки отличаются по странам — найм настоящий, не копии."""
        kz = v(name="Специалист службы поддержки", employer={"id": "1"},
               salary={"from": 200000, "currency": "KZT"})
        kg = v(name="Специалист службы поддержки", employer={"id": "1"},
               salary={"from": 26000, "currency": "KGS"})
        assert ad_key(kz) != ad_key(kg)
