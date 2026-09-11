"""Создаёт бакет в хранилище, если его ещё нет.

Раньше это делал контейнер minio/mc, но он не резолвил имя `minio`
через внутренний DNS Docker. Своим boto3 — надёжнее и на одну зависимость меньше.

    .venv/bin/python scripts/init_bucket.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from botocore.exceptions import ClientError  # noqa: E402

from ingestion.config import S3Config  # noqa: E402
from ingestion.storage.s3 import RawStorage  # noqa: E402


def main() -> int:
    cfg = S3Config.from_env()
    storage = RawStorage(cfg)
    client = storage._client  # noqa: SLF001 — служебный скрипт
    print(f"хранилище: {cfg.endpoint_url}, бакет: {cfg.bucket}")

    try:
        client.head_bucket(Bucket=cfg.bucket)
        print("бакет уже есть")
    except ClientError as exc:
        if exc.response["Error"]["Code"] not in ("404", "NoSuchBucket", "403"):
            raise
        client.create_bucket(Bucket=cfg.bucket)
        print("бакет создан")

    try:
        client.put_bucket_versioning(
            Bucket=cfg.bucket, VersioningConfiguration={"Status": "Enabled"}
        )
        print("версионирование включено")
    except ClientError as exc:
        print(f"версионирование не включилось ({exc}) — не критично, продолжаем")

    # Проверяем, что запись и чтение реально работают
    probe = "raw/_healthcheck.json.gz"
    storage.write_json(probe, {"ok": True})
    assert storage.read_json(probe) == {"ok": True}
    client.delete_object(Bucket=cfg.bucket, Key=probe)
    print("запись и чтение проверены ✓")
    return 0


if __name__ == "__main__":
    sys.exit(main())
