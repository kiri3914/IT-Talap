"""Pydantic-модели для hh.

ВАЖНО (ТЗ §3.3): на raw-слое модель — СИГНАЛЬНАЯ, а не блокирующая.
extra="allow", всё опционально. Задача — заметить, что схема источника поехала,
и поднять алерт. Данные к этому моменту уже записаны в бакет.

Строгие модели появятся на staging, где их падение ничего не теряет.
"""

from __future__ import annotations

import json
from pathlib import Path

from pydantic import BaseModel, ConfigDict, ValidationError


class RawModel(BaseModel):
    model_config = ConfigDict(extra="allow")


class HHSalary(RawModel):
    salary_from: int | None = None
    salary_to: int | None = None
    currency: str | None = None
    gross: bool | None = None

    model_config = ConfigDict(extra="allow", populate_by_name=True)


class HHVacancyListItem(RawModel):
    """Минимум, на который мы опираемся в списке выдачи."""

    id: str | None = None
    name: str | None = None
    published_at: str | None = None
    created_at: str | None = None
    employer: dict | None = None
    area: dict | None = None
    salary: dict | None = None
    professional_roles: list[dict] | None = None


KNOWN_FIELDS_PATH = Path(__file__).parent / "hh_known_fields.json"


def _known_fields() -> set[str]:
    """Поля, которые уже видели. Отсутствие файла = первый запуск."""
    base = set(HHVacancyListItem.model_fields)
    if KNOWN_FIELDS_PATH.exists():
        try:
            base |= set(json.loads(KNOWN_FIELDS_PATH.read_text()))
        except (json.JSONDecodeError, OSError):
            pass
    return base


def _remember_fields(fields: set[str]) -> None:
    try:
        merged = sorted(_known_fields() | fields)
        KNOWN_FIELDS_PATH.write_text(json.dumps(merged, indent=2, ensure_ascii=False))
    except OSError:
        pass  # не смогли запомнить — переживём, алерт просто повторится


class SchemaIssue(BaseModel):
    """Расхождение схемы. Не исключение — отчёт для алерта."""

    kind: str
    count: int
    sample: str


def check_list_items(items: list[dict]) -> list[SchemaIssue]:
    """Проверяет пачку элементов выдачи. Никогда не бросает исключений."""
    issues: list[SchemaIssue] = []

    invalid: list[str] = []
    for item in items:
        try:
            HHVacancyListItem.model_validate(item)
        except ValidationError as exc:
            invalid.append(str(exc)[:200])
    if invalid:
        issues.append(
            SchemaIssue(kind="validation_error", count=len(invalid), sample=invalid[0])
        )

    missing_id = [i for i in items if not i.get("id")]
    if missing_id:
        issues.append(
            SchemaIssue(
                kind="missing_id",
                count=len(missing_id),
                sample=str(missing_id[0])[:200],
            )
        )

    # Поля, которых раньше не было. Алертим только на действительно новые:
    # hh отдаёт ~48 полей, модель объявляет 8 — без базы известных полей
    # алерт срабатывал бы каждый запуск и его перестали бы читать.
    unknown: set[str] = set()
    for item in items[:100]:
        unknown |= set(item)
    new_fields = unknown - _known_fields()
    if new_fields:
        issues.append(
            SchemaIssue(
                kind="new_fields",
                count=len(new_fields),
                sample=", ".join(sorted(new_fields)[:15]),
            )
        )
        _remember_fields(unknown)  # чтобы не повторять тот же алерт завтра

    return issues
