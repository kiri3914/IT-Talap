"""Ищет, какой параметр /vacancies вызывает 400.

Перебирает комбинации от минимальной к полной и печатает ответ API целиком.
После того как виноватый параметр найден — правим sources/hh.py.

    .venv/bin/python scripts/probe_hh.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx  # noqa: E402

from ingestion.config import HHConfig  # noqa: E402

CASES: list[tuple[str, dict]] = [
    ("только area", {"area": 40}),
    ("area + per_page", {"area": 40, "per_page": 100}),
    ("area + page", {"area": 40, "per_page": 100, "page": 0}),
    ("area + role", {"area": 40, "professional_role": 156}),
    ("area + order_by", {"area": 40, "order_by": "publication_time"}),
    ("area + host", {"area": 40, "host": "hh.kz"}),
    ("role + host", {"area": 40, "professional_role": 156, "host": "hh.kz"}),
    ("всё как в коде", {
        "area": 40, "professional_role": 156, "host": "hh.kz",
        "order_by": "publication_time", "page": 0, "per_page": 100,
    }),
    ("всё без host", {
        "area": 40, "professional_role": 156,
        "order_by": "publication_time", "page": 0, "per_page": 100,
    }),
    ("всё без order_by", {
        "area": 40, "professional_role": 156, "host": "hh.kz",
        "page": 0, "per_page": 100,
    }),
    ("date_from/date_to", {
        "area": 40, "professional_role": 156, "per_page": 100,
        "date_from": "2026-09-01T00:00:00", "date_to": "2026-09-11T00:00:00",
    }),
]


def main() -> int:
    cfg = HHConfig.from_env()
    token = cfg.resolve_token()
    headers = {"User-Agent": cfg.user_agent, "Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    print(f"токен: {'есть' if token else 'НЕТ'}\n")
    print(f"{'случай':22} {'код':5} результат")
    print("-" * 78)

    with httpx.Client(base_url="https://api.hh.ru", headers=headers, timeout=30.0) as client:
        for label, params in CASES:
            try:
                r = client.get("/vacancies", params=params)
            except httpx.HTTPError as exc:
                print(f"{label:22} ---   сетевая ошибка: {exc}")
                continue

            if r.status_code == 200:
                payload = r.json()
                print(
                    f"{label:22} {r.status_code:<5} "
                    f"found={payload.get('found')} pages={payload.get('pages')} "
                    f"per_page={payload.get('per_page')}"
                )
            else:
                print(f"{label:22} {r.status_code:<5} {r.text[:300]}")

    print("\nЕсли 200 везде, кроме случаев с каким-то одним параметром — он и виноват.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
