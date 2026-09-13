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
    import sys

    path = Path(__file__).parent.parent / "scripts" / f"{name}.py"
    py_compile.compile(str(path), doraise=True)

    # sys.executable, а не "python": в venv последнего может не быть в PATH
    result = subprocess.run(
        [sys.executable, "-m", "ruff", "check", "--select", "F821",
         "--output-format", "concise", str(path)],
        capture_output=True, text=True,
    )
    if "F821" in result.stdout:
        raise AssertionError(f"неразрешённые имена в {name}.py:\n{result.stdout}")


def test_нет_голого_coalesce_по_jsonb():
    """coalesce(payload -> 'a', payload -> 'b') не работает: jsonb 'null'
    не является SQL NULL, поэтому второй аргумент недостижим.
    Нашлось на живых данных: запрос показывал 100% раскрытия зарплат."""
    import re as _re
    for path in MODELS:
        sql = path.read_text(encoding="utf-8")
        for m in _re.finditer(r"coalesce\(\s*([^)]*?->[^)]*?)\)", sql, _re.S):
            fragment = m.group(1)
            if "->" in fragment and "nullif" not in fragment and "->>" not in fragment:
                raise AssertionError(
                    f"{path.name}: coalesce по jsonb без nullif(..., 'null'::jsonb):\n"
                    f"  {fragment.strip()[:160]}"
                )


def test_нет_is_not_null_по_jsonb_объекту():
    """`payload -> 'salary' is not null` истинно и для JSON-null."""
    import re as _re
    for path in MODELS:
        sql = path.read_text(encoding="utf-8")
        bad = _re.findall(r"payload\s*->\s*'\w+'\s+is\s+not\s+null", sql, _re.I)
        assert not bad, f"{path.name}: {bad} — использовать jsonb_typeof(...) = 'object'"
