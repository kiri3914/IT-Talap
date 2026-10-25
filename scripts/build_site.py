"""Сборка сайта из шаблона site/index.html и данных site/data.json.

На выходе два файла:
  site/dist/index.html     — полный документ: его кладут на хостинг и
                             открывают локально
  site/dist/artifact.html  — тот же сайт без <html>/<head>: для превью
                             в Claude, которое само оборачивает страницу

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
BODY_START = "<header"

HEAD = """<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
"""


def main() -> int:
    template = (ROOT / "site/index.html").read_text(encoding="utf-8")
    data = json.loads((ROOT / "site/data.json").read_text(encoding="utf-8"))
    if template.count(PLACEHOLDER) != 1 or template.count(BODY_START) != 1:
        print(f"в шаблоне должно быть ровно по одному {PLACEHOLDER} и {BODY_START}",
              file=sys.stderr)
        return 1
    # </script> внутри JSON закрыл бы тег раньше времени
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    page = template.replace(PLACEHOLDER, payload)

    head, body = page.split(BODY_START, 1)
    # Без явной кодировки браузер прочтёт UTF-8 как Latin-1: локальный
    # http.server и многие хостинги не пишут charset в заголовке ответа.
    full = f"{HEAD}{head.strip()}\n</head>\n<body>\n{BODY_START}{body.rstrip()}\n</body>\n</html>\n"

    out = ROOT / "site/dist"
    out.mkdir(parents=True, exist_ok=True)
    (out / "index.html").write_text(full, encoding="utf-8")
    (out / "artifact.html").write_text(page, encoding="utf-8")
    print(f"собрано site/dist/index.html ({len(full.encode()) // 1024} КБ) и artifact.html")
    return 0


if __name__ == "__main__":
    sys.exit(main())
