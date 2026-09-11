"""Pydantic-модели для hh.

ВАЖНО (ТЗ §3.3): на raw-слое модель — СИГНАЛЬНАЯ, а не блокирующая.
extra="allow", всё опционально. Задача — заметить, что схема источника поехала,
и поднять алерт. Данные к этому моменту уже записаны в бакет.

Строгие модели появятся на staging, где их падение ничего не теряет.
"""

from __future__ import annotations

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

    # Незнакомые поля — не ошибка, но повод посмотреть: возможно, источник расширил схему
    known = set(HHVacancyListItem.model_fields)
    unknown: set[str] = set()
    for item in items[:100]:
        unknown |= set(item) - known
    if unknown:
        issues.append(
            SchemaIssue(
                kind="new_fields",
                count=len(unknown),
                sample=", ".join(sorted(unknown)[:15]),
            )
        )

    return issues
