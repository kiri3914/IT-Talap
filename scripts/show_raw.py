"""Что лежит в raw-слое: партиции, объёмы, количество вакансий.

    .venv/bin/python scripts/show_raw.py              # сводка по дням
    .venv/bin/python scripts/show_raw.py --files      # файлы целиком
    .venv/bin/python scripts/show_raw.py --peek       # заглянуть в одну вакансию
"""

from __future__ import annotations

import argparse
import re
import sys
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ingestion.config import S3Config  # noqa: E402
from ingestion.storage.s3 import RawStorage  # noqa: E402

KEY_RE = re.compile(
    r"raw/(?P<source>[^/]+)/country=(?P<country>[^/]+)/dt=(?P<dt>[\d-]+)/(?P<kind>[a-z_]+)-\d+"
)


def human(size: int) -> str:
    for unit in ("Б", "КБ", "МБ", "ГБ"):
        if size < 1024:
            return f"{size:.0f} {unit}" if unit == "Б" else f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} ТБ"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--files", action="store_true", help="показать файлы")
    parser.add_argument("--peek", action="store_true", help="показать одну вакансию целиком")
    args = parser.parse_args()

    cfg = S3Config.from_env()
    storage = RawStorage(cfg)
    client = storage._client  # noqa: SLF001

    # Ключи с размерами — list_keys их не отдаёт, идём напрямую
    objects: list[tuple[str, int]] = []
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=cfg.bucket, Prefix="raw/"):
        objects.extend((o["Key"], o["Size"]) for o in page.get("Contents", []))

    if not objects:
        print(f"бакет {cfg.bucket} пуст")
        return 0

    if args.files:
        for key, size in sorted(objects):
            print(f"{human(size):>10}  {key}")
        print(f"\nвсего файлов: {len(objects)}, объём: {human(sum(s for _, s in objects))}")
        return 0

    if args.peek:
        key = next(k for k, _ in sorted(objects) if "vacancy_details" in k)
        payload = storage.read_json(key) or []
        if payload:
            import json
            print(f"из {key}:\n")
            print(json.dumps(payload[0], ensure_ascii=False, indent=2)[:4000])
        return 0

    # Сводка: страна × дата
    stats: dict[tuple[str, str], dict] = defaultdict(
        lambda: {"list_bytes": 0, "det_bytes": 0, "list_files": 0, "det_files": 0}
    )
    for key, size in objects:
        m = KEY_RE.match(key)
        if not m:
            continue
        cell = stats[(m["country"], m["dt"])]
        if m["kind"] == "vacancies_list":
            cell["list_bytes"] += size
            cell["list_files"] += 1
        else:
            cell["det_bytes"] += size
            cell["det_files"] += 1

    print(f"бакет: {cfg.bucket}  ({cfg.endpoint_url})\n")
    print(f"{'дата':12} {'стр':4} {'списки':>12} {'детали':>12} {'файлов':>7}")
    print("-" * 52)

    dates = sorted({dt for _, dt in stats})
    for dt in dates:
        for country in sorted({c for c, d in stats if d == dt}):
            s = stats[(country, dt)]
            print(
                f"{dt:12} {country:4} {human(s['list_bytes']):>12} "
                f"{human(s['det_bytes']):>12} {s['list_files'] + s['det_files']:>7}"
            )

    total = sum(s for _, s in objects)
    print("-" * 52)
    print(f"{'ИТОГО':17} {human(total):>25} {len(objects):>7}")

    # Дыры в истории — главное, ради чего этот скрипт
    if len(dates) > 1:
        first, last = date.fromisoformat(dates[0]), date.fromisoformat(dates[-1])
        expected = {(first + timedelta(days=i)).isoformat() for i in range((last - first).days + 1)}
        missing = sorted(expected - set(dates))
        print()
        if missing:
            print(f"⚠️  ПРОПУЩЕНЫ ДНИ ({len(missing)}): {', '.join(missing)}")
            print("    Бэкфилл невозможен — hh не отдаёт вчерашнюю выдачу.")
        else:
            print(f"✓ история без пропусков: {dates[0]} … {dates[-1]} ({len(dates)} дн.)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
