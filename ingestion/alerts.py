"""Алерты в Telegram. Без них дыру в данных замечают через месяц (ТЗ §7.3)."""

from __future__ import annotations

import logging

import httpx

from ingestion.config import AlertConfig

log = logging.getLogger(__name__)


def send(cfg: AlertConfig, text: str) -> None:
    if not cfg.enabled:
        log.info("алерты не настроены, сообщение в лог: %s", text)
        return
    try:
        httpx.post(
            f"https://api.telegram.org/bot{cfg.bot_token}/sendMessage",
            json={"chat_id": cfg.chat_id, "text": text[:4000], "disable_web_page_preview": True},
            timeout=15.0,
        )
    except httpx.HTTPError as exc:
        log.error("не удалось отправить алерт: %s", exc)
