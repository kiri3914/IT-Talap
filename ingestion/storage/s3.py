"""Клиент объектного хранилища.

Единственная задача — положить сырой ответ как есть.
Никакой обработки: raw-слой по определению принимает всё.
"""

from __future__ import annotations

import gzip
import json
import logging
from typing import Any

import boto3
from botocore.config import Config as BotoConfig

from ingestion.config import S3Config

log = logging.getLogger(__name__)


class RawStorage:
    def __init__(self, cfg: S3Config) -> None:
        self._bucket = cfg.bucket
        self._client = boto3.client(
            "s3",
            endpoint_url=cfg.endpoint_url,
            aws_access_key_id=cfg.access_key_id,
            aws_secret_access_key=cfg.secret_access_key,
            region_name=cfg.region,
            config=BotoConfig(retries={"max_attempts": 5, "mode": "standard"}),
        )

    @staticmethod
    def key(source: str, country: str, dt: str, kind: str, part: int) -> str:
        """raw/hh/country=kz/dt=2026-09-04/vacancies_list-000.json.gz"""
        return f"raw/{source}/country={country}/dt={dt}/{kind}-{part:03d}.json.gz"

    @staticmethod
    def channel_key(source: str, channel: str, dt: str, part: int) -> str:
        """raw/telegram/channel=workitkz/dt=2026-09-12/posts-000.json.gz"""
        return f"raw/{source}/channel={channel}/dt={dt}/posts-{part:03d}.json.gz"

    def write_json(self, key: str, payload: Any) -> int:
        """Пишет объект как gzip-JSON. Возвращает размер в байтах."""
        body = gzip.compress(
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        )
        self._client.put_object(
            Bucket=self._bucket,
            Key=key,
            Body=body,
            ContentType="application/json",
            ContentEncoding="gzip",
        )
        log.info("записано %s (%d байт)", key, len(body))
        return len(body)

    def read_json(self, key: str) -> Any | None:
        """Читает объект. None, если ключа нет."""
        try:
            obj = self._client.get_object(Bucket=self._bucket, Key=key)
        except self._client.exceptions.NoSuchKey:
            return None
        except Exception as exc:  # noqa: BLE001 — отсутствие ключа не должно ронять запуск
            log.warning("не удалось прочитать %s: %s", key, exc)
            return None
        return json.loads(gzip.decompress(obj["Body"].read()).decode("utf-8"))

    def list_keys(self, prefix: str) -> list[str]:
        keys: list[str] = []
        paginator = self._client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self._bucket, Prefix=prefix):
            keys.extend(item["Key"] for item in page.get("Contents", []))
        return keys

    def delete_prefix(self, prefix: str) -> int:
        """Идемпотентность: повторный запуск за дату перезаписывает партицию целиком."""
        keys = self.list_keys(prefix)
        for i in range(0, len(keys), 1000):
            batch = [{"Key": k} for k in keys[i : i + 1000]]
            self._client.delete_objects(Bucket=self._bucket, Delete={"Objects": batch})
        if keys:
            log.info("очищено %d объектов по префиксу %s", len(keys), prefix)
        return len(keys)
