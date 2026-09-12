"""Тесты разбора телеграм-постов.

Все три бага, найденные при замере 2026-09-12, закреплены тестами:
число без валюты, разделители разрядов, страна из справочника каналов.
"""

from __future__ import annotations

import pytest

from enrichment.telegram_fields import parse_post, parse_salary


class TestParseSalary:
    @pytest.mark.parametrize(
        "text,expected",
        [
            ("30000 - 70000 KGS в месяц", (30000, 70000, "KGS")),
            ("От 150000 KGS в месяц", (150000, None, "KGS")),
            ("500 000 - 600 000 тенге", (500000, 600000, "KZT")),
            ("от 800,000 тенге", (800000, None, "KZT")),   # запятая как разделитель
            ("100.000 тенге", (100000, None, "KZT")),       # точка как разделитель
            ("2500 USD", (2500, None, "USD")),
            ("15 000 000 сум", (15000000, None, "UZS")),
        ],
    )
    def test_явная_валюта(self, text, expected):
        got = parse_salary(text)
        assert (got.get("salary_from"), got.get("salary_to"), got.get("currency")) == expected

    def test_число_без_валюты_не_берётся_без_подсказки(self):
        # Иначе номер телефона или год станут вилкой
        assert parse_salary("800000") == {}

    def test_число_без_валюты_берётся_с_подсказкой(self):
        got = parse_salary("800000", "KZT")
        assert got["salary_from"] == 800000
        assert got["currency"] == "KZT"

    def test_вилка_без_валюты_с_подсказкой(self):
        got = parse_salary("500 000 - 600 000", "KZT")
        assert (got["salary_from"], got["salary_to"]) == (500000, 600000)

    @pytest.mark.parametrize("text", ["Это стажировка", "опыт от 3 лет", "", "500"])
    def test_не_зарплата(self, text):
        assert parse_salary(text) == {}
        assert parse_salary(text, "KZT") == {}


class TestParsePost:
    def test_шаблон_workitkz(self):
        post = {
            "channel": "workitkz",
            "post_id": "workitkz/7758",
            "published_at": "2026-09-07T07:29:01+00:00",
            "views": 10300,
            "text": (
                "#вакансия #астана #гибрид #fullstack\n"
                "Должность: Senior Fullstack разработчик\n"
                "Компания: ТОО Digital Alliance\n"
                "Город: Астана\n"
                "Занятость: гибрид\n"
                "Оплата: 800000\n"
            ),
        }
        got = parse_post(post)
        assert got["title"] == "Senior Fullstack разработчик"
        assert got["company"] == "ТОО Digital Alliance"
        assert got["city"] == "Астана"
        # Валюта подставлена по стране канала, хотя в тексте её нет
        assert got["salary_from"] == 800000
        assert got["currency"] == "KZT"
        assert got["country"] == "kz"
        assert got["source_id"] == "workitkz/7758"

    def test_шаблон_findwork_с_внешним_id(self):
        post = {
            "channel": "findwork",
            "post_id": "findwork/60734",
            "text": (
                "EDU BRIDGE: Куратор по поступлению\n"
                "Тип: Работа в офисе\n"
                "30000 - 70000 KGS в месяц\n"
                "Тэги: #edubridge #office #bishkek\n"
                "Требования тут: https://devkg.com/tg/j-22899\n"
            ),
        }
        got = parse_post(post)
        assert got["company"] == "EDU BRIDGE"
        assert got["title"] == "Куратор по поступлению"
        assert got["external_id"] == "j-22899"   # единственный стабильный ID в телеграме
        assert got["salary_from"] == 30000
        assert got["currency"] == "KGS"
        assert got["country"] == "kg"

    def test_страна_из_справочника_а_не_из_поля(self):
        """Баг 2026-09-12: parse_post читал country из поля, которое
        проставляет другой модуль при записи. В изоляции логика валют
        молча отключалась."""
        post = {"channel": "workitkz", "post_id": "workitkz/1", "text": "Оплата: 500000"}
        assert "country" not in post
        assert parse_post(post)["currency"] == "KZT"

    def test_город_из_хештега(self):
        post = {"channel": "devkz_jobs", "post_id": "devkz_jobs/1",
                "text": "#алматы #python\nPython разработчик"}
        assert parse_post(post)["city"] == "Алматы"

    @pytest.mark.parametrize("text,expected", [
        ("Оплата: 500 000 (На руки)", False),
        ("Оплата: 500 000 до вычета налогов", True),
        ("Оплата: 500 000", None),
    ])
    def test_gross_net(self, text, expected):
        post = {"channel": "workitkz", "post_id": "workitkz/1", "text": text}
        assert parse_post(post).get("gross") is expected

    def test_пустой_пост_не_роняет(self):
        got = parse_post({"channel": "workitkz", "post_id": "workitkz/1", "text": ""})
        assert got["source_id"] == "workitkz/1"
        assert "salary_from" not in got
