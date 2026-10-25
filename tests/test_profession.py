"""Распознавание профессии по заголовку."""

import pytest

from enrichment.profession import guess_profession


@pytest.mark.parametrize(
    ("title", "expected"),
    [
        ("Senior Python Developer", "developer"),
        ("Программист 1С", "developer"),
        ("Frontend-разработчик (React)", "developer"),
        # узкие роли должны побеждать широкие
        ("DevOps-разработчик", "devops"),
        ("Руководитель отдела разработки", "dev_lead"),
        ("Team Lead Java", "dev_lead"),
        ("Data Engineer", "data_analyst"),
        ("ML Engineer", "data_scientist"),
        ("QA Automation Engineer", "qa"),
        ("Системный аналитик", "systems_analyst"),
        ("Бизнес-аналитик", "business_analyst"),
        ("Аналитик", "analyst"),
        ("UI/UX дизайнер", "designer"),
        ("Product Manager", "product_manager"),
        ("Руководитель проектов", "project_manager"),
        ("Специалист технической поддержки", "support"),
        ("Системный администратор", "sysadmin"),
        ("Специалист по информационной безопасности", "security"),
        ("Технический директор (CTO)", "cto"),
    ],
)
def test_распознаёт(title, expected):
    assert guess_profession(title) == expected


@pytest.mark.parametrize("title", [None, "", "Бухгалтер", "Водитель категории B"])
def test_не_выдумывает(title):
    assert guess_profession(title) is None


def test_правила_для_приложения_не_устарели():
    """Браузер берёт правила из сгенерированного JSON — он обязан совпадать с Python."""
    from scripts.gen_profession_rules import OUT, render

    assert OUT.read_text(encoding="utf-8") == render(), (
        "professionRules.json устарел: python -m scripts.gen_profession_rules"
    )
