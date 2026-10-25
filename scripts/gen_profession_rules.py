"""Правила распознавания профессии — из Python в JSON для приложения.

    .venv/bin/python -m scripts.gen_profession_rules

Источник правды один: enrichment/profession.py. Браузер получает их как JSON,
а не переписанную вручную копию. tests/test_profession.py проверяет, что
файл не устарел.
"""

from __future__ import annotations

import json
from pathlib import Path

from enrichment.profession import _RULES

OUT = Path(__file__).resolve().parent.parent / "web/src/model/professionRules.json"


def render() -> str:
    return json.dumps([[code, alts] for code, alts in _RULES], ensure_ascii=False, indent=1) + "\n"


def main() -> None:
    OUT.write_text(render(), encoding="utf-8")
    print(f"записано {OUT.relative_to(OUT.parents[3])}")


if __name__ == "__main__":
    main()
