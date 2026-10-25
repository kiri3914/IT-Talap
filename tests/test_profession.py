"""Распознавание профессии по заголовку.

Примеры лежат в tests/profession_cases.json — по ним же проверяется
TypeScript-версия правил в приложении (web/src/model/resume.test.ts).
"""

import json
from pathlib import Path

import pytest

from enrichment.profession import guess_profession

CASES = json.loads((Path(__file__).parent / "profession_cases.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize(("title", "expected"), CASES["match"])
def test_распознаёт(title, expected):
    assert guess_profession(title) == expected


@pytest.mark.parametrize("title", [None, *CASES["none"]])
def test_не_выдумывает(title):
    assert guess_profession(title) is None


def test_правила_для_приложения_не_устарели():
    """Браузер берёт правила из сгенерированного JSON — он обязан совпадать с Python."""
    from scripts.gen_profession_rules import OUT, render

    assert OUT.read_text(encoding="utf-8") == render(), (
        "professionRules.json устарел: python -m scripts.gen_profession_rules"
    )
