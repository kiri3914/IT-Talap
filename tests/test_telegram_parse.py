"""Тесты разбора HTML телеграм-превью."""

from __future__ import annotations

import pytest

from ingestion.sources.telegram import parse_page, parse_views

PAGE = """
<div class="tgme_widget_message_wrap">
  <div class="tgme_widget_message" data-post="workitkz/7758">
    <div class="tgme_widget_message_text js-message_text">
      #вакансия #астана<br/>Должность: Разработчик<br/>Оплата: 800000
    </div>
    <div class="tgme_widget_message_footer">
      <span class="tgme_widget_message_views">10.3K</span>
      <time datetime="2026-09-07T07:29:01+00:00"></time>
    </div>
  </div>
</div>
<div class="tgme_widget_message_wrap">
  <div class="tgme_widget_message" data-post="workitkz/7759">
    <div class="tgme_widget_message_text js-message_text">Второй пост &amp; символы</div>
    <div class="tgme_widget_message_views">980</div>
    <time datetime="2026-09-08T10:00:00+00:00"></time>
  </div>
</div>
"""


def test_разбирает_все_посты():
    posts = parse_page(PAGE, "workitkz")
    assert len(posts) == 2
    assert [p["message_id"] for p in posts] == [7758, 7759]


def test_поля_первого_поста():
    post = parse_page(PAGE, "workitkz")[0]
    assert post["post_id"] == "workitkz/7758"
    assert post["views"] == 10300
    assert post["published_at"] == "2026-09-07T07:29:01+00:00"
    assert post["url"] == "https://t.me/workitkz/7758"
    assert "Должность: Разработчик" in post["text"]
    assert post["hashtags"] == ["вакансия", "астана"]


def test_html_сущности_раскрываются():
    assert "&" in parse_page(PAGE, "workitkz")[1]["text"]


@pytest.mark.parametrize("raw,expected", [
    ("10.3K", 10300), ("1.2M", 1200000), ("980", 980),
    ("2.5K", 2500), (None, None), ("", None), ("abc", None),
])
def test_просмотры(raw, expected):
    assert parse_views(raw) == expected


def test_пустая_страница():
    assert parse_page("<html></html>", "workitkz") == []


def _page(ids: list[int]) -> str:
    """Страница превью с заданными ID постов."""
    return "".join(
        f'<div class="tgme_widget_message_wrap">'
        f'<div class="tgme_widget_message" data-post="workitkz/{i}">'
        f'<div class="tgme_widget_message_text js-message_text">пост {i}</div>'
        f'<time datetime="2026-09-07T07:29:01+00:00"></time>'
        f"</div></div>"
        for i in ids
    )


class FakeHTTP:
    """Канал из 60 постов, отдающий страницы то по 20, то по 19."""

    def __init__(self, sizes: list[int]) -> None:
        self.sizes = sizes
        self.calls = 0
        self.next_id = 1000

    def get_text(self, path: str, params: dict | None = None) -> str:
        if self.calls >= len(self.sizes):
            return ""  # архив кончился
        size = self.sizes[self.calls]
        self.calls += 1
        ids = list(range(self.next_id - size, self.next_id))
        self.next_id -= size
        return _page(ids)

    def close(self) -> None:
        pass


def test_короткая_страница_не_обрывает_пагинацию(monkeypatch):
    """Регресс: телеграм отдаёт 19 постов вместо 20 — это не конец канала.

    На workitkz такая страница обрывала сбор на 98 постах из ~7700.
    Конец архива определяется только тем, что новых ID больше не приходит.
    """
    from ingestion.sources import telegram

    client = telegram.TelegramClient.__new__(telegram.TelegramClient)
    client._http = FakeHTTP([20, 19, 20])  # вторая страница короткая

    posts = client.fetch_channel("workitkz", max_posts=500)

    assert len(posts) == 59, "сбор оборвался на короткой странице"
