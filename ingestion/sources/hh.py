"""Источник hh.

Три ограничения API, вокруг которых построен весь модуль (ТЗ §3.2):

1. Глубина выдачи ограничена (page * per_page). Одним запросом всю выдачу не забрать —
   отсюда адаптивная нарезка: режем по area x professional_role, а если и это не влезает,
   рекурсивно делим окно дат публикации.
2. Список не содержит полного описания. Детали — отдельный запрос на каждую вакансию,
   поэтому грузим их только для новых ID (дельта со вчера).
3. hh.kz / hh.uz / hh.kg — не отдельные API. Один api.hh.ru, география — через area.

Коды area и professional_role НЕ хардкодятся: справочники живые, берём их из API.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from ingestion.config import HHConfig
from ingestion.http import RateLimitedClient

log = logging.getLogger(__name__)

BASE_URL = "https://api.hh.ru"
PER_PAGE = 100
# Документированная граница глубины выдачи. Проверить своими руками при первом запуске.
DEPTH_LIMIT = 2000
MAX_SPLIT_DEPTH = 8
IT_CATEGORY_MARKERS = ("информационные технологии", "information technology")

# Параметр host НЕ используется: hh.kg — недопустимое значение
# ("Invalid host argument", проверено 2026-09-11), а география
# полностью задаётся area. host влиял бы только на домен в ссылках ответа.
COUNTRIES: dict[str, dict[str, str]] = {
    "kz": {"area_name": "Казахстан"},
    "uz": {"area_name": "Узбекистан"},
    "kg": {"area_name": "Кыргызстан"},
}


@dataclass
class FetchStats:
    requests: int = 0
    windows_split: int = 0
    truncated_slices: list[str] = field(default_factory=list)


class HHClient:
    def __init__(self, cfg: HHConfig) -> None:
        headers = {"User-Agent": cfg.user_agent, "Accept": "application/json"}
        token = cfg.resolve_token()
        if token:
            headers["Authorization"] = f"Bearer {token}"
        else:
            log.warning("токен не задан — /vacancies вернёт 403")
        self._http = RateLimitedClient(BASE_URL, headers)
        self.stats = FetchStats()

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> HHClient:
        return self

    def __exit__(self, *args: object) -> None:
        self.close()

    # --- справочники ---

    def resolve_area_id(self, country_name: str) -> str:
        """Ищет id страны в /areas. Не хардкодим — справочник живой."""
        self.stats.requests += 1
        for country in self._http.get_json("/areas"):
            if country.get("name", "").strip().lower() == country_name.lower():
                return str(country["id"])
        raise RuntimeError(f"страна {country_name!r} не найдена в /areas")

    def resolve_it_role_ids(self) -> list[str]:
        """Берёт роли из IT-категории /professional_roles."""
        self.stats.requests += 1
        payload = self._http.get_json("/professional_roles")
        for category in payload.get("categories", []):
            name = category.get("name", "").strip().lower()
            if any(marker in name for marker in IT_CATEGORY_MARKERS):
                return [str(role["id"]) for role in category.get("roles", [])]
        raise RuntimeError("IT-категория не найдена в /professional_roles")

    # --- выдача ---

    def _search_page(self, params: dict, page: int) -> dict:
        self.stats.requests += 1
        return self._http.get_json(
            "/vacancies", params={**params, "page": page, "per_page": PER_PAGE}
        )

    def _collect_slice(self, params: dict, label: str, depth: int) -> list[dict]:
        """Забирает один срез. Если не влезает в глубину выдачи — делит окно дат пополам."""
        first = self._search_page(params, page=0)
        found = int(first.get("found", 0))

        if found == 0:
            return []

        if found > DEPTH_LIMIT:
            if depth >= MAX_SPLIT_DEPTH:
                log.warning("срез %s не делится дальше: found=%d, берём что влезло", label, found)
                self.stats.truncated_slices.append(f"{label} (found={found})")
            else:
                return self._split_by_date(params, label, depth, found)

        items = list(first.get("items", []))
        pages = min(int(first.get("pages", 1)), DEPTH_LIMIT // PER_PAGE)
        for page in range(1, pages):
            items.extend(self._search_page(params, page).get("items", []))
        return items

    def _split_by_date(self, params: dict, label: str, depth: int, found: int) -> list[dict]:
        """Делит окно публикации пополам и собирает половины по отдельности."""
        date_from = _parse_dt(params.get("date_from")) or datetime.utcnow() - timedelta(days=400)
        date_to = _parse_dt(params.get("date_to")) or datetime.utcnow()

        if (date_to - date_from) < timedelta(hours=2):
            log.warning("окно %s меньше 2 часов, дальше не делим (found=%d)", label, found)
            self.stats.truncated_slices.append(f"{label} (found={found})")
            return self._collect_slice({**params, "date_from": None}, label, MAX_SPLIT_DEPTH)

        middle = date_from + (date_to - date_from) / 2
        self.stats.windows_split += 1
        log.info("делю %s: found=%d > %d", label, found, DEPTH_LIMIT)

        items: list[dict] = []
        for lo, hi, suffix in (
            (date_from, middle, "a"),
            (middle, date_to, "b"),
        ):
            items.extend(
                self._collect_slice(
                    {**params, "date_from": _fmt_dt(lo), "date_to": _fmt_dt(hi)},
                    f"{label}/{suffix}",
                    depth + 1,
                )
            )
        return items

    def fetch_counters(self, country: str) -> dict:
        """Счётчики рынка на сегодня: сколько всего вакансий и сколько по каждой роли.

        Дёшево (26 запросов) и невосстановимо: общее число вакансий по стране
        нигде не хранится, а доля IT во времени — метрика, которой ни у кого нет.
        Плюс это основа проверки объёма из ТЗ §8.1 и витрины спроса.
        """
        area_id = self.resolve_area_id(COUNTRIES[country]["area_name"])
        role_ids = self.resolve_it_role_ids()

        self.stats.requests += 1
        total = int(
            self._http.get_json("/vacancies", params={"area": area_id, "per_page": 1})
            .get("found", 0)
        )

        by_role: dict[str, int] = {}
        for role_id in role_ids:
            self.stats.requests += 1
            by_role[role_id] = int(
                self._http.get_json(
                    "/vacancies",
                    params={"area": area_id, "professional_role": role_id, "per_page": 1},
                ).get("found", 0)
            )

        it_total = sum(by_role.values())  # у вакансии ровно одна роль — проверено 2026-09-12
        log.info(
            "%s: всего %d, IT %d (%.1f%%)",
            country, total, it_total, 100 * it_total / total if total else 0,
        )
        return {
            "country": country,
            "area_id": area_id,
            "vacancies_total": total,
            "vacancies_it": it_total,
            "it_share": round(it_total / total, 5) if total else None,
            "by_role": by_role,
        }

    def fetch_country_list(self, country: str) -> list[dict]:
        """Полная выдача IT-вакансий по стране на сегодня."""
        area_id = self.resolve_area_id(COUNTRIES[country]["area_name"])
        role_ids = self.resolve_it_role_ids()
        log.info("%s: area=%s, IT-ролей %d", country, area_id, len(role_ids))

        seen: set[str] = set()
        result: list[dict] = []
        for role_id in role_ids:
            params = {
                "area": area_id,
                "professional_role": role_id,
                "order_by": "publication_time",
            }
            for item in self._collect_slice(params, f"{country}/role={role_id}", depth=0):
                vacancy_id = str(item.get("id", ""))
                if vacancy_id and vacancy_id not in seen:
                    seen.add(vacancy_id)
                    result.append(item)

        log.info("%s: собрано %d уникальных вакансий", country, len(result))
        return result

    def fetch_details(self, vacancy_ids: list[str]) -> list[dict]:
        """Детали по списку ID. Дорого — вызывать только для дельты."""
        details: list[dict] = []
        for num, vacancy_id in enumerate(vacancy_ids, start=1):
            try:
                self.stats.requests += 1
                details.append(self._http.get_json(f"/vacancies/{vacancy_id}"))
            except Exception as exc:  # noqa: BLE001 — одна вакансия не должна ронять запуск
                log.warning("деталь %s не получена: %s", vacancy_id, exc)
            if num % 100 == 0 or num == len(vacancy_ids):
                log.info("детали: %d/%d", num, len(vacancy_ids))
        return details


def _fmt_dt(value: datetime) -> str:
    return value.strftime("%Y-%m-%dT%H:%M:%S")


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.strptime(value, "%Y-%m-%dT%H:%M:%S")


def today() -> str:
    return date.today().isoformat()
