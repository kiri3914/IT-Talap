"""Восстановление партиции из версий объектов в бакете.

Нужно, когда партицию затёрли: например, запустили сбор с --dt за прошлую
дату. Источник не отдаёт вчерашнюю выдачу, поэтому единственный способ
вернуть исходный снимок — версии объектов.

    python scripts/restore_partition.py --prefix raw/hh/country=kz/dt=2026-09-11/ --list
    python scripts/restore_partition.py --prefix raw/hh/country=kz/dt=2026-09-11/ --before 2026-09-12T00:00:00
"""

from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ingestion.config import S3Config  # noqa: E402
from ingestion.storage.s3 import RawStorage  # noqa: E402


def versions(client, bucket: str, prefix: str) -> dict[str, list[dict]]:
    by_key: dict[str, list[dict]] = defaultdict(list)
    paginator = client.get_paginator("list_object_versions")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for v in page.get("Versions", []):
            by_key[v["Key"]].append(
                {"id": v["VersionId"], "ts": v["LastModified"],
                 "size": v["Size"], "latest": v["IsLatest"], "marker": False}
            )
        for m in page.get("DeleteMarkers", []):
            by_key[m["Key"]].append(
                {"id": m["VersionId"], "ts": m["LastModified"],
                 "size": 0, "latest": m["IsLatest"], "marker": True}
            )
    for key in by_key:
        by_key[key].sort(key=lambda v: v["ts"], reverse=True)
    return by_key


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--prefix", required=True)
    parser.add_argument("--list", action="store_true", help="только показать версии")
    parser.add_argument("--before", help="восстановить последнюю версию до этого времени, ISO")
    args = parser.parse_args()

    cfg = S3Config.from_env()
    storage = RawStorage(cfg)
    client = storage._client  # noqa: SLF001

    by_key = versions(client, cfg.bucket, args.prefix)
    if not by_key:
        print(f"версий по префиксу {args.prefix} нет")
        return 1

    if args.list or not args.before:
        for key in sorted(by_key):
            print(f"\n{key}")
            for v in by_key[key]:
                kind = "удаление" if v["marker"] else f"{v['size']:>9} б"
                mark = " ← текущая" if v["latest"] else ""
                print(f"  {v['ts']:%Y-%m-%d %H:%M:%S}  {kind}  {v['id'][:18]}{mark}")
        if not args.before:
            print("\nЧтобы восстановить, укажите --before с моментом ДО порчи, например:")
            print(f"  --before {datetime.now(timezone.utc):%Y-%m-%d}T00:00:00")
        return 0

    cutoff = datetime.fromisoformat(args.before).replace(tzinfo=timezone.utc)
    restored = skipped = 0
    for key, vs in sorted(by_key.items()):
        candidate = next((v for v in vs if v["ts"] <= cutoff and not v["marker"]), None)
        if not candidate:
            print(f"  — {key}: нет версии до {cutoff:%Y-%m-%d %H:%M}")
            skipped += 1
            continue
        if candidate["latest"]:
            print(f"  = {key}: уже актуальна")
            skipped += 1
            continue
        client.copy_object(
            Bucket=cfg.bucket,
            Key=key,
            CopySource={"Bucket": cfg.bucket, "Key": key, "VersionId": candidate["id"]},
        )
        print(f"  ✓ {key}: восстановлена версия от {candidate['ts']:%Y-%m-%d %H:%M:%S}")
        restored += 1

    print(f"\nвосстановлено {restored}, пропущено {skipped}")
    print("Проверьте: .venv/bin/python scripts/show_raw.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
