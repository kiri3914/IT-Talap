"""Проверка dbt-моделей без базы.

Полноценно они проверяются через `dbt run` на живом Postgres, но опечатку
в SQL стоит ловить раньше — до того, как модель поедет на сервер.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

sqlglot = pytest.importorskip("sqlglot", reason="pip install -e '.[dev]'")

MODELS = sorted((Path(__file__).parent.parent / "dbt" / "models").rglob("*.sql"))


def strip_jinja(sql: str) -> str:
    sql = re.sub(r"\{\{\s*config\([^}]*\)\s*\}\}", "", sql)
    sql = re.sub(r"\{\{\s*source\(\s*'([^']+)'\s*,\s*'([^']+)'\s*\)\s*\}\}", r"\1.\2", sql)
    sql = re.sub(r"\{\{\s*ref\(\s*'([^']+)'\s*\)\s*\}\}", r"\1", sql)
    return sql


@pytest.mark.parametrize("path", MODELS, ids=lambda p: p.name)
def test_модель_разбирается(path: Path):
    sqlglot.parse_one(strip_jinja(path.read_text(encoding="utf-8")), dialect="postgres")


@pytest.mark.parametrize("path", MODELS, ids=lambda p: p.name)
def test_ссылки_только_через_ref_и_source(path: Path):
    """Прямое обращение к схеме в обход source() ломает lineage."""
    sql = path.read_text(encoding="utf-8")
    bare = re.findall(r"(?<!')\b(raw_landing|staging|core|marts)\.\w+", sql)
    assert not bare, f"обращение в обход source()/ref(): {bare}"


def test_модели_вообще_есть():
    assert MODELS, "не найдено ни одной модели"


def test_scripts_являются_пакетом():
    """scripts/_data.py импортируется как scripts._data — без __init__
    относительный импорт в скриптах ломается."""
    assert (Path(__file__).parent.parent / "scripts" / "__init__.py").exists()


@pytest.mark.parametrize(
    "name",
    [p.stem for p in sorted((Path(__file__).parent.parent / "scripts").glob("*.py"))
     if not p.stem.startswith("__")],
    ids=lambda n: n,
)
def test_скрипт_компилируется(name: str):
    """Ловит неразрешённые имена без запуска скрипта: ruff --fix удаляет
    импорт, когда он не используется, а следующая правка его возвращает."""
    import py_compile
    import subprocess
    path = Path(__file__).parent.parent / "scripts" / f"{name}.py"
    py_compile.compile(str(path), doraise=True)
    result = subprocess.run(
        ["python", "-m", "ruff", "check", "--select", "F821", "--quiet", str(path)],
        capture_output=True, text=True,
    )
    if result.returncode not in (0, 1) or "F821" in result.stdout:
        raise AssertionError(f"неразрешённые имена в {name}.py:\n{result.stdout}")
