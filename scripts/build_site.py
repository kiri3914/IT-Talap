"""Сборка сайта: шаблон site/index.html + site/data.json -> site/dist/index.html.

Данные встраиваются в страницу, а не грузятся отдельным запросом: первый
кадр должен быть полным сразу — для превью ссылок и медленного интернета.

    .venv/bin/python -m scripts.build_site
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLACEHOLDER = "/*__TALAP_DATA__*/"


def main() -> int:
    template = (ROOT / "site/index.html").read_text(encoding="utf-8")
    data = json.loads((ROOT / "site/data.json").read_text(encoding="utf-8"))
    if template.count(PLACEHOLDER) != 1:
        print(f"в шаблоне должен быть ровно один {PLACEHOLDER}", file=sys.stderr)
        return 1
    # </script> внутри JSON закрыл бы тег раньше времени
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    out = ROOT / "site/dist/index.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(template.replace(PLACEHOLDER, payload), encoding="utf-8")
    print(f"собрано {out.relative_to(ROOT)}: {out.stat().st_size // 1024} КБ")
    return 0


if __name__ == "__main__":
    sys.exit(main())
