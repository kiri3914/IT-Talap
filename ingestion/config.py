"""Конфигурация из окружения. Ничего не хардкодим в коде."""

from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


def _require(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Не задана переменная окружения {name} (см. .env.example)")
    return value


@dataclass(frozen=True)
class S3Config:
    endpoint_url: str
    access_key_id: str
    secret_access_key: str
    bucket: str
    region: str

    @classmethod
    def from_env(cls) -> S3Config:
        return cls(
            endpoint_url=_require("S3_ENDPOINT_URL"),
            access_key_id=_require("S3_ACCESS_KEY_ID"),
            secret_access_key=_require("S3_SECRET_ACCESS_KEY"),
            bucket=_require("S3_BUCKET"),
            region=os.getenv("S3_REGION", "auto"),
        )


@dataclass(frozen=True)
class HHConfig:
    user_agent: str
    token: str | None

    @classmethod
    def from_env(cls) -> HHConfig:
        return cls(
            user_agent=_require("HH_USER_AGENT"),
            token=os.getenv("HH_TOKEN", "").strip() or None,
        )


@dataclass(frozen=True)
class AlertConfig:
    bot_token: str | None
    chat_id: str | None

    @classmethod
    def from_env(cls) -> AlertConfig:
        return cls(
            bot_token=os.getenv("TELEGRAM_BOT_TOKEN", "").strip() or None,
            chat_id=os.getenv("TELEGRAM_CHAT_ID", "").strip() or None,
        )

    @property
    def enabled(self) -> bool:
        return bool(self.bot_token and self.chat_id)
