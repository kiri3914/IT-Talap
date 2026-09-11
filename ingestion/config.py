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
    client_id: str | None
    client_secret: str | None

    @classmethod
    def from_env(cls) -> HHConfig:
        return cls(
            user_agent=_require("HH_USER_AGENT"),
            token=os.getenv("HH_TOKEN", "").strip() or None,
            client_id=os.getenv("HH_CLIENT_ID", "").strip() or None,
            client_secret=os.getenv("HH_CLIENT_SECRET", "").strip() or None,
        )

    def resolve_token(self) -> str | None:
        """Готовый HH_TOKEN, либо обмен client_credentials на application token."""
        if self.token:
            return self.token
        if self.client_id and self.client_secret:
            from ingestion.auth import fetch_application_token

            return fetch_application_token(self.client_id, self.client_secret, self.user_agent)
        return None


@dataclass(frozen=True)
class PostgresConfig:
    host: str
    port: int
    user: str
    password: str
    database: str

    @classmethod
    def from_env(cls) -> PostgresConfig:
        return cls(
            host=os.getenv("PG_HOST", "127.0.0.1"),
            port=int(os.getenv("PG_PORT", "5442")),
            user=os.getenv("PG_USER", "talap"),
            password=_require("PG_PASSWORD"),
            database=os.getenv("PG_DATABASE", "talap"),
        )

    @property
    def dsn(self) -> str:
        return (
            f"postgresql://{self.user}:{self.password}"
            f"@{self.host}:{self.port}/{self.database}"
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
