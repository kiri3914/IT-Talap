"""Залить сырьё из tar-архива в бакет. Нужен при переезде на новый сервер.

    python -m scripts.restore_raw_from_tar talap-raw-2026-10-26.tar
    python -m scripts.restore_raw_from_tar talap-raw-2026-10-26.tar --dry-run

Архив делается выгрузкой всего бакета (ключи объектов = пути в архиве).
Существующие объекты НЕ перезаписываются: на новом сервере ночной сбор
мог уже положить свежие партиции, и затирать их старой копией нельзя.
"""

from __future__ import annotations

import argparse
import sys
import tarfile

from botocore.exceptions import ClientError

from ingestion.config import S3Config
from ingestion.storage.s3 import RawStorage


def _exists(s3, bucket: str, key: str) -> bool:
    try:
        s3.head_object(Bucket=bucket, Key=key)
        return True
    except ClientError as exc:
        if exc.response["Error"]["Code"] in ("404", "NoSuchKey", "NotFound"):
            return False
        raise


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("archive")
    parser.add_argument("--dry-run", action="store_true", help="только посчитать")
    args = parser.parse_args()

    storage = RawStorage(S3Config.from_env())
    s3 = storage._client if hasattr(storage, "_client") else storage._s3
    bucket = storage._bucket

    uploaded = skipped = 0
    with tarfile.open(args.archive, mode="r:*") as tar:
        for member in tar:
            if not member.isfile() or not member.name.startswith("raw/"):
                continue
            if _exists(s3, bucket, member.name):
                skipped += 1
                continue
            if not args.dry_run:
                body = tar.extractfile(member).read()
                s3.put_object(Bucket=bucket, Key=member.name, Body=body)
            uploaded += 1

    verb = "залил бы" if args.dry_run else "залито"
    print(f"{verb}: {uploaded}, уже были: {skipped}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
