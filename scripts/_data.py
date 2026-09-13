"""Загрузка вакансий из raw-слоя для аналитических скриптов.

Главная тонкость: детали грузятся ТОЛЬКО для новых ID (дельта со вчера),
поэтому в партиции за дату лежат детали лишь тех вакансий, что появились
в этот день. За 2026-09-13 это 19 записей при 3 328 активных.

Отсюда правило: «вакансии, активные на дату» = ID из СПИСКА за эту дату,
а детали подтягиваются оттуда, где они были записаны.

Чтение всех деталей разом — несколько мегабайт, для трёх стран приемлемо.
Когда истории накопится много, сюда придёт кеш или запрос к Postgres.
"""

from __future__ import annotations

import re
from functools import lru_cache

from ingestion.storage.s3 import RawStorage

COUNTRIES = ("kz", "uz", "kg")


def available_dates(storage: RawStorage, prefix: str = "raw/hh/") -> list[str]:
    return sorted({
        m.group(1) for key in storage.list_keys(prefix)
        if (m := re.search(r"dt=([\d-]+)", key))
    })


def active_ids(storage: RawStorage, dt: str, country: str) -> set[str]:
    """ID вакансий, присутствовавших в выдаче на дату."""
    ids: set[str] = set()
    for key in storage.list_keys(f"raw/hh/country={country}/dt={dt}/vacancies_list-"):
        ids |= {str(i["id"]) for i in (storage.read_json(key) or []) if i.get("id")}
    return ids


@lru_cache(maxsize=4)
def _all_details(storage_id: int, country: str) -> tuple[dict, ...]:
    storage = _STORAGES[storage_id]
    by_id: dict[str, dict] = {}
    for key in sorted(storage.list_keys(f"raw/hh/country={country}/")):
        if "vacancy_details-" not in key:
            continue
        for item in storage.read_json(key) or []:
            if vid := item.get("id"):
                by_id[str(vid)] = item      # более поздняя запись побеждает
    return tuple(by_id.values())


_STORAGES: dict[int, RawStorage] = {}


def load_active(storage: RawStorage, dt: str, countries=COUNTRIES) -> list[dict]:
    """Вакансии, активные на дату, с деталями.

    Не то же самое, что «детали из партиции за дату»: последних всего
    столько, сколько вакансий в этот день появилось впервые.
    """
    _STORAGES[id(storage)] = storage
    result: list[dict] = []
    for country in countries:
        ids = active_ids(storage, dt, country)
        if not ids:
            continue
        for item in _all_details(id(storage), country):
            if str(item.get("id")) in ids:
                item = dict(item)
                item["_country"] = country
                result.append(item)
    return result


def coverage(storage: RawStorage, dt: str, countries=COUNTRIES) -> tuple[int, int]:
    """Сколько активных вакансий и для скольких есть детали."""
    _STORAGES[id(storage)] = storage
    total = with_details = 0
    for country in countries:
        ids = active_ids(storage, dt, country)
        total += len(ids)
        have = {str(i.get("id")) for i in _all_details(id(storage), country)}
        with_details += len(ids & have)
    return total, with_details
