"""Источник: публичные Telegram-каналы с вакансиями.

Telethon и api_id НЕ нужны: у публичных каналов есть веб-превью
`t.me/s/<канал>`, которое отдаётся обычным HTTP без авторизации.
Проверено 2026-09-12: до 20 постов на страницу, пагинация через ?before=<id>.
ВАЖНО: страница может отдать 19 и меньше — удалённые сообщения и альбомы.
Считать короткую страницу концом канала нельзя: на workitkz это обрывало
сбор на 98 постах из ~7700. Конец определяем только по отсутствию новых ID.

Устройство постов сильно отличается от hh:
  • стабильного ID вакансии нет — есть только (channel, message_id)
  • схемы нет: шаблон это соглашение админа канала, ломается молча
  • закрытие вакансии никак не отражается, пост просто остаётся висеть
  • зато вилку указывают почти всегда, и есть счётчик просмотров

Поэтому здесь мы храним пост целиком как есть. Разбор полей — на staging.
"""

from __future__ import annotations

import html
import logging
import re

from ingestion.http import RateLimitedClient

log = logging.getLogger(__name__)

BASE_URL = "https://t.me"
POSTS_PER_PAGE = 20

# Каналы из разведки (docs/sources/telegram.md).
# @headhunter_uz сознательно исключён: ретранслятор hh.uz, задвоил бы данные.
CHANNELS: dict[str, dict[str, str]] = {
    "workitkz": {"country": "kz", "title": "Work IT KZ"},
    "devkz_jobs": {"country": "kz", "title": "DevKZ Jobs"},
    "findwork": {"country": "kg", "title": "Jobs | DevKG"},
    "uzdev_jobs": {"country": "uz", "title": "UzDev Jobs"},
}

_POST_BLOCK = re.compile(
    r'<div class="tgme_widget_message_wrap.*?(?=<div class="tgme_widget_message_wrap|$)', re.S
)
_FIELDS = {
    "post_id": re.compile(r'data-post="([^"]+)"'),
    "published_at": re.compile(r'<time datetime="([^"]+)"'),
    "views": re.compile(r'tgme_widget_message_views">([^<]+)<'),
}
_TEXT = re.compile(r'class="tgme_widget_message_text[^"]*"[^>]*>(.*?)</div>', re.S)
_TAG = re.compile(r"<[^>]+>")
_BR = re.compile(r"<br\s*/?>")


def _clean(raw_html: str) -> str:
    return html.unescape(_TAG.sub("", _BR.sub("\n", raw_html))).strip()


def parse_views(raw: str | None) -> int | None:
    """«10.3K» -> 10300, «1.2M» -> 1200000."""
    if not raw:
        return None
    text = raw.strip().upper().replace(" ", "")
    multiplier = {"K": 1_000, "M": 1_000_000}.get(text[-1:], 1)
    if multiplier > 1:
        text = text[:-1]
    try:
        return int(float(text) * multiplier)
    except ValueError:
        return None


def parse_page(page_html: str, channel: str) -> list[dict]:
    posts: list[dict] = []
    for block in _POST_BLOCK.findall(page_html):
        post: dict = {"channel": channel}
        for name, pattern in _FIELDS.items():
            m = pattern.search(block)
            post[name] = m.group(1) if m else None
        if not post["post_id"]:
            continue

        post["message_id"] = int(post["post_id"].rsplit("/", 1)[-1])
        post["views"] = parse_views(post["views"])
        post["url"] = f"{BASE_URL}/{post['post_id']}"

        text_m = _TEXT.search(block)
        post["text"] = _clean(text_m.group(1)) if text_m else ""
        post["hashtags"] = re.findall(r"#(\w+)", post["text"])
        posts.append(post)
    return posts


class TelegramClient:
    def __init__(self, user_agent: str) -> None:
        # Пауза больше, чем у hh: это веб-морда, а не API для машин
        self._http = RateLimitedClient(
            BASE_URL, {"User-Agent": user_agent}, min_interval=1.0
        )

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> TelegramClient:
        return self

    def __exit__(self, *args: object) -> None:
        self.close()

    def fetch_channel(self, channel: str, max_posts: int = 200) -> list[dict]:
        """Свежие посты канала, от новых к старым."""
        collected: dict[int, dict] = {}
        before: int | None = None

        while len(collected) < max_posts:
            params = {"before": before} if before else None
            page = self._http.get_text(f"/s/{channel}", params=params)
            posts = parse_page(page, channel)
            if not posts:
                break

            new = {p["message_id"]: p for p in posts if p["message_id"] not in collected}
            if not new:
                break  # страница повторилась — это и есть начало канала
            collected.update(new)

            before = min(p["message_id"] for p in posts)

        result = sorted(collected.values(), key=lambda p: -p["message_id"])[:max_posts]
        log.info("%s: собрано %d постов", channel, len(result))
        return result
