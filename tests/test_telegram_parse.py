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
