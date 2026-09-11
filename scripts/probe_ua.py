"""Подбирает User-Agent, который принимает hh.

hh отвечает 400 bad_user_agent / blacklisted на неподходящий заголовок.
Скрипт перебирает форматы и показывает, какие проходят.

    .venv/bin/python scripts/probe_ua.py
    .venv/bin/python scripts/probe_ua.py "Свой вариант/1.0 (mail@example.com)"
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx  # noqa: E402

from ingestion.config import HHConfig  # noqa: E402

EMAIL = "kiri.bekos@gmail.com"

CANDIDATES = [
    # Формат из документации hh: <имя приложения>/<версия> (<контакт>)
    f"Talap/1.0 ({EMAIL})",
    f"Talap/0.1 ({EMAIL})",
    # Без версии
    f"Talap ({EMAIL})",
    # Имя приложения как на dev.hh.ru — подставьте своё, если отличается
    f"IT-Talap/1.0 ({EMAIL})",
    # С указанием назначения
    f"Talap/1.0 (job market analytics; {EMAIL})",
    # Текущий вариант из .env — для сравнения
    None,
    # Совсем простой
    "Talap",
    f"talap-app/1.0 ({EMAIL})",
]


def main() -> int:
    cfg = HHConfig.from_env()
    token = cfg.resolve_token()

    candidates = list(CANDIDATES)
    if len(sys.argv) > 1:
        candidates = [sys.argv[1]]
    else:
        candidates = [c if c is not None else cfg.user_agent for c in candidates]

    print(f"токен: {'есть' if token else 'НЕТ'}\n")
    print(f"{'код':5} {'User-Agent':50} результат")
    print("-" * 100)

    working: list[str] = []
    for ua in candidates:
        headers = {"User-Agent": ua, "Accept": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        try:
            r = httpx.get(
                "https://api.hh.ru/vacancies",
                params={"area": 40, "per_page": 1},
                headers=headers,
                timeout=30.0,
            )
        except httpx.HTTPError as exc:
            print(f"---   {ua[:50]:50} сетевая ошибка: {exc}")
            continue

        if r.status_code == 200:
            found = r.json().get("found")
            print(f"200 ✓ {ua[:50]:50} found={found}")
            working.append(ua)
        else:
            detail = r.json().get("description", r.text[:80]) if r.text else ""
            print(f"{r.status_code}   {ua[:50]:50} {detail}")

    print()
    if working:
        print("Рабочий вариант — пропишите в .env:")
        print(f"  HH_USER_AGENT={working[0]}")
    else:
        print("Ни один не прошёл. Возможные причины:")
        print("  • имя приложения в UA должно совпадать с зарегистрированным на dev.hh.ru")
        print("  • попробуйте своё: .venv/bin/python scripts/probe_ua.py 'Имя/1.0 (почта)'")
    return 0 if working else 1


if __name__ == "__main__":
    sys.exit(main())
