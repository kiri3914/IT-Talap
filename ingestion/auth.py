"""Получение application token для hh.

Для чтения публичных вакансий достаточно grant_type=client_credentials —
это токен приложения, без авторизации пользователя. Redirect URI здесь не нужен:
он участвует только в authorization_code flow, когда действуют от имени человека.

Токен кешируется на диск, чтобы не дёргать /token на каждом запуске.
"""

from __future__ import annotations

import json
import logging
import time
from pathlib import Path

import httpx

log = logging.getLogger(__name__)

TOKEN_URL = "https://api.hh.ru/token"
CACHE_PATH = Path.home() / ".cache" / "talap" / "hh_token.json"
# Обновляем заранее, чтобы не поймать протухание в середине запуска
REFRESH_MARGIN_SECONDS = 24 * 3600


def _read_cache() -> str | None:
    if not CACHE_PATH.exists():
        return None
    try:
        cached = json.loads(CACHE_PATH.read_text())
    except (json.JSONDecodeError, OSError) as exc:
        log.warning("кеш токена нечитаем (%s), запрошу новый", exc)
        return None
    if cached.get("expires_at", 0) - time.time() < REFRESH_MARGIN_SECONDS:
        log.info("токен в кеше скоро истечёт, запрошу новый")
        return None
    return cached.get("access_token")


def _write_cache(access_token: str, expires_in: int) -> None:
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    CACHE_PATH.write_text(
        json.dumps({"access_token": access_token, "expires_at": time.time() + expires_in})
    )
    CACHE_PATH.chmod(0o600)  # токен — секрет, не оставляем читаемым для всех


def fetch_application_token(client_id: str, client_secret: str, user_agent: str) -> str:
    """Обменивает client_id/client_secret на application token."""
    cached = _read_cache()
    if cached:
        return cached

    log.info("запрашиваю application token у %s", TOKEN_URL)
    response = httpx.post(
        TOKEN_URL,
        data={
            "grant_type": "client_credentials",
            "client_id": client_id,
            "client_secret": client_secret,
        },
        headers={"User-Agent": user_agent},
        timeout=30.0,
    )
    if response.status_code != 200:
        raise RuntimeError(
            f"не удалось получить токен: {response.status_code} {response.text[:300]}"
        )

    payload = response.json()
    token = payload.get("access_token")
    if not token:
        raise RuntimeError(f"в ответе нет access_token: {payload}")

    expires_in = int(payload.get("expires_in", 14 * 24 * 3600))
    _write_cache(token, expires_in)
    log.info("токен получен, живёт %d дней", expires_in // 86400)
    return token
