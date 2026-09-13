"""Ключи вакансии и нормализация полей.

Чистые функции: ключ объявления, ключ размещения, город работы,
режим выплаты. Их используют и аналитические скрипты, и core-модели —
логика должна быть одна, иначе цифры разойдутся.

Основания — docs/findings-03 и findings-04.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata

# Только месячные ставки сравнимы между собой. В данных на 2026-09-14:
# MONTH 1276, SERVICE 16, SHIFT 5, FLY_IN_FLY_OUT 3, HOUR 1.
MONTHLY = "MONTH"

# Слова-синонимы, приводимые к общей форме перед хешированием
_SYNONYMS = {
    "разработчик": "developer",
    "программист": "developer",
    "инженер-программист": "developer",
    "тестировщик": "qa",
    "аналитик": "analyst",
    "дизайнер": "designer",
    "администратор": "admin",
}
# Признаки настоящего регионального найма: такие вакансии не схлопываем
_FIELD_WORK = re.compile(
    r"(выездн\w+|в разъезд\w*|мобильн\w+ (?:инженер|специалист)|"
    r"field\s+(?:engineer|service)|разъездн\w+)", re.I
)
_PUNCT = re.compile(r"[^\w\s]", re.UNICODE)
_SPACES = re.compile(r"\s+")


def normalize_title(title: str | None) -> str:
    """Заголовок к сравнимому виду: регистр, пунктуация, эмодзи, синонимы."""
    if not title:
        return ""
    text = unicodedata.normalize("NFKC", title).lower()
    # Эмодзи и прочие символы вне букв/цифр
    text = "".join(ch for ch in text if unicodedata.category(ch)[0] != "S")
    text = _PUNCT.sub(" ", text)
    words = [_SYNONYMS.get(w, w) for w in _SPACES.sub(" ", text).strip().split()]
    return " ".join(words)


def salary_mode(vacancy: dict) -> str | None:
    """Период, за который указана сумма.

    Есть только в salary_range. У записей без него считаем месячной:
    поле появилось позже, и у старых вакансий его нет.
    """
    rng = vacancy.get("salary_range")
    if isinstance(rng, dict) and isinstance(rng.get("mode"), dict):
        return rng["mode"].get("id")
    return MONTHLY if vacancy.get("salary") else None


def is_monthly(vacancy: dict) -> bool:
    return salary_mode(vacancy) == MONTHLY


def salary_of(vacancy: dict) -> dict | None:
    """Вилка. Читает оба поля: у hh их два, и они не всегда совпадают."""
    raw = vacancy.get("salary") or vacancy.get("salary_range")
    return raw if isinstance(raw, dict) else None


def work_city(vacancy: dict) -> str | None:
    """Город, где действительно работать.

    `area` — раздел размещения, `address.city` — место работы. У релокационных
    вакансий они расходятся: area = Астана, address.city = Лимасол при
    зарплате EUR 7000 (findings-03). Считать надо по месту работы.
    """
    address = vacancy.get("address")
    if isinstance(address, dict) and (city := address.get("city")):
        return str(city).strip()
    area = vacancy.get("area")
    return str(area["name"]).strip() if isinstance(area, dict) and area.get("name") else None


def posting_city(vacancy: dict) -> str | None:
    """Город раздела, в котором размещено объявление."""
    area = vacancy.get("area")
    return str(area["name"]).strip() if isinstance(area, dict) and area.get("name") else None


def is_relocation(vacancy: dict) -> bool:
    """Место работы отличается от раздела размещения."""
    work, posting = work_city(vacancy), posting_city(vacancy)
    return bool(work and posting and work != posting)


def employer_id(vacancy: dict) -> str | None:
    """Стабильный ключ компании внутри hh — нормализация имени не нужна."""
    emp = vacancy.get("employer")
    return str(emp["id"]) if isinstance(emp, dict) and emp.get("id") else None


def ad_key(vacancy: dict) -> str:
    """Ключ ОБЪЯВЛЕНИЯ — без города.

    hh создаёт отдельный vacancy_id на каждый регион размещения: одно
    объявление «Специалист по 1С» висит в девяти городах и считается
    девятью вакансиями, завышая спрос на 4.2% (findings-04).

    Город намеренно не входит в ключ. Спрос считается по объявлениям,
    городская статистика — по размещениям.
    """
    sal = salary_of(vacancy) or {}
    parts = [
        employer_id(vacancy) or "",
        normalize_title(vacancy.get("name")),
        str(sal.get("from") or ""),
        str(sal.get("to") or ""),
        str(sal.get("currency") or ""),
    ]
    return hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()[:16]  # noqa: S324


def posting_key(vacancy: dict) -> str:
    """Ключ РАЗМЕЩЕНИЯ — объявление плюс город раздела."""
    return hashlib.sha1(  # noqa: S324
        f"{ad_key(vacancy)}|{posting_city(vacancy) or ''}".encode()
    ).hexdigest()[:16]


def looks_like_field_work(vacancy: dict) -> bool:
    """Похоже на настоящий региональный найм, а не на размноженное объявление.

    «Выездной инженер техподдержки» в 11 городах — вероятно, 11 реальных
    мест. Схлопывать такие в одно значит занижать спрос.
    """
    return bool(_FIELD_WORK.search(vacancy.get("name") or ""))
