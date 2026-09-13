"""Аудит персональных данных в собранном массиве.

Считает, какие персональные данные у нас фактически есть — в бакете
и в Postgres. Значения МАСКИРУЮТСЯ: вывод безопасно показывать и хранить.

По ТЗ §10 контакты вырезаются на staging, но raw хранит карточку целиком
и вечно. По закону о персональных данных хранение — это обработка,
поэтому надо знать, что именно лежит.

    .venv/bin/python scripts/audit_pii.py
    .venv/bin/python scripts/audit_pii.py --samples   показать замаскированные примеры
"""

from __future__ import annotations

import argparse
import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ingestion.config import S3Config  # noqa: E402
from ingestion.storage.s3 import RawStorage  # noqa: E402
from scripts._data import available_dates, load_active  # noqa: E402

EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]{2,}")
PHONE = re.compile(r"(?:\+?\d[\d\s()\-]{8,}\d)")
TELEGRAM = re.compile(r"(?<![\w/])@[a-zA-Z][\w]{4,31}\b")
HTML_TAG = re.compile(r"<[^>]+>")

# ФИО физлица в названии работодателя: «МУСАЕВА УЛПАШ ИСАЕВНА», «ИП Иванов И.И.»
PERSON_EMPLOYER = re.compile(
    r"^(?:ип|жк|ижс)?\s*[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?$|"
    r"^[А-ЯЁ]{3,}\s+[А-ЯЁ]{3,}(?:\s+[А-ЯЁ]{3,})?$|"
    r"\bИП\s+[А-ЯЁ][а-яё]+\s+[А-ЯЁ]\.\s*[А-ЯЁ]\.",
)


def mask(text: str, kind: str) -> str:
    """Оставляет форму, убирает содержимое."""
    if kind == "email":
        name, _, domain = text.partition("@")
        return f"{name[:2]}***@{domain[:2]}***"
    if kind == "phone":
        digits = re.sub(r"\D", "", text)
        return f"+{digits[:3]}…{digits[-2:]} ({len(digits)} цифр)"
    if kind == "telegram":
        return f"@{text[1:3]}***"
    if kind == "person":
        return " ".join(w[0] + "·" * (len(w) - 1) for w in text.split()[:3])
    return text[:10] + "…"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--samples", action="store_true")
    parser.add_argument("--dt")
    args = parser.parse_args()

    storage = RawStorage(S3Config.from_env())
    dates = available_dates(storage)
    if not dates:
        print("в бакете пусто")
        return 1
    dt = args.dt or dates[-1]

    vacancies = load_active(storage, dt)
    total = len(vacancies)
    print(f"дата: {dt}, проверено вакансий: {total}\n")

    found: dict[str, list[str]] = {k: [] for k in
                                   ("contacts", "email", "phone", "telegram", "person")}
    contact_shapes: Counter[str] = Counter()

    for v in vacancies:
        # 1. Структурное поле contacts
        contacts = v.get("contacts")
        if isinstance(contacts, dict) and contacts:
            keys = sorted(k for k, val in contacts.items() if val)
            contact_shapes[", ".join(keys)] += 1
            if name := contacts.get("name"):
                found["contacts"].append(mask(str(name), "person"))
            if email := contacts.get("email"):
                found["email"].append(mask(str(email), "email"))
            for phone in contacts.get("phones") or []:
                if isinstance(phone, dict):
                    num = "".join(str(phone.get(k) or "") for k in
                                  ("country", "city", "number"))
                    if num:
                        found["phone"].append(mask(num, "phone"))

        # 2. Контакты внутри описания
        desc = HTML_TAG.sub(" ", v.get("description") or "")
        for m in EMAIL.findall(desc):
            found["email"].append(mask(m, "email"))
        for m in PHONE.findall(desc):
            if 9 <= len(re.sub(r"\D", "", m)) <= 15:
                found["phone"].append(mask(m, "phone"))
        for m in TELEGRAM.findall(desc):
            found["telegram"].append(mask(m, "telegram"))

        # 3. ФИО физлица как работодатель
        emp = (v.get("employer") or {}).get("name") or ""
        if emp and PERSON_EMPLOYER.search(emp.strip()):
            found["person"].append(mask(emp.strip(), "person"))

    labels = {
        "contacts": "имя контактного лица (поле contacts)",
        "email": "адреса почты",
        "phone": "телефоны",
        "telegram": "телеграм-аккаунты",
        "person": "ФИО физлица как название работодателя",
    }
    print(f"{'что':44} {'найдено':>9} {'уникальных':>11}")
    print("-" * 68)
    for key, label in labels.items():
        items = found[key]
        print(f"{label:44} {len(items):>9} {len(set(items)):>11}")

    if contact_shapes:
        print("\nЗаполненные поля в contacts:")
        for shape, n in contact_shapes.most_common():
            print(f"  {shape:40} {n:>5}")
    else:
        print("\nСтруктурное поле contacts пустое у всех вакансий.")

    if args.samples:
        print("\nПримеры (замаскированы):")
        for key, label in labels.items():
            uniq = sorted(set(found[key]))[:6]
            if uniq:
                print(f"  {label}:")
                for s in uniq:
                    print(f"    {s}")

    any_pii = sum(len(v) for v in found.values())
    print(f"\n{'=' * 68}")
    if any_pii:
        print(f"Всего вхождений персональных данных: {any_pii}")
        print("\nЭто лежит в RAW и хранится бессрочно. По ТЗ §10 контакты")
        print("вырезаются на staging — но хранение само по себе является")
        print("обработкой персональных данных.")
        print("\nРешить: вырезать при записи, ограничить срок хранения raw,")
        print("либо зафиксировать правовое основание документом.")
    else:
        print("Персональных данных не обнаружено.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
