"""Сверка детекции закрытий с тем, что говорит сам источник.

Мы определяем закрытие по исчезновению из выдачи (правило двух пропусков,
ТЗ §7.3). Но на странице снятой вакансии hh пишет «В архиве с 11 сентября» —
то есть точная дата у источника есть.

Скрипт берёт вакансии, пропавшие из выдачи, и запрашивает их по
/vacancies/{id}. Проверяем три вещи:

  1. доступна ли снятая вакансия по прямой ссылке
  2. переключается ли `archived` в true
  3. есть ли в ответе дата архивации — тогда время жизни считается точно,
     а не выводится из пропусков

    .venv/bin/python scripts/check_closures.py
    .venv/bin/python scripts/check_closures.py --limit 40
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ingestion.config import HHConfig, S3Config  # noqa: E402
from ingestion.sources.hh import HHClient  # noqa: E402
from ingestion.storage.s3 import RawStorage  # noqa: E402
from scripts._data import active_ids, available_dates  # noqa: E402

log = logging.getLogger("talap.closures")

# Поля-кандидаты на дату архивации. Известных нет — ищем любое,
# что появится у снятой вакансии и отсутствовало у живой.
KNOWN_FIELDS_SAMPLE = 60


def disappeared(storage: RawStorage, dates: list[str], country: str) -> list[str]:
    """ID, бывшие в выдаче и пропавшие в двух последних срезах подряд."""
    if len(dates) < 3:
        return []
    was = active_ids(storage, dates[-3], country)
    gone_1 = was - active_ids(storage, dates[-2], country)
    return sorted(gone_1 - active_ids(storage, dates[-1], country))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=25)
    parser.add_argument("--country", action="append")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)-7s %(name)s | %(message)s")
    for noisy in ("httpx", "httpcore", "botocore", "boto3", "urllib3"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    storage = RawStorage(S3Config.from_env())
    dates = available_dates(storage)
    if len(dates) < 3:
        print(f"нужно минимум 3 даты, есть {len(dates)}")
        return 1

    print(f"срезы: {dates[-3]} → {dates[-2]} → {dates[-1]}\n")

    targets: list[tuple[str, str]] = []
    for country in args.country or ("kz", "uz", "kg"):
        ids = disappeared(storage, dates, country)
        print(f"  {country}: пропало из выдачи {len(ids)}")
        targets += [(country, i) for i in ids]

    if not targets:
        print("\nнет вакансий, пропавших два среза подряд")
        return 0

    targets = targets[: args.limit]
    print(f"\nпроверяю {len(targets)} через API…\n")

    stats = {"200": 0, "404": 0, "archived": 0, "other": 0}
    new_fields: set[str] = set()
    rows: list[dict] = []

    cfg = HHConfig.from_env()
    with HHClient(cfg) as client:
        for country, vid in targets:
            try:
                payload = client._http.get_json(f"/vacancies/{vid}")  # noqa: SLF001
            except Exception as exc:  # noqa: BLE001
                text = str(exc)
                stats["404" if "404" in text else "other"] += 1
                rows.append({"id": vid, "country": country, "status": "недоступна"})
                continue

            stats["200"] += 1
            archived = bool(payload.get("archived"))
            stats["archived"] += archived
            new_fields |= {
                k for k, v in payload.items()
                if v not in (None, [], {}, False) and ("archiv" in k or "close" in k
                                                       or k.endswith("_at"))
            }
            rows.append({
                "id": vid,
                "country": country,
                "status": "в архиве" if archived else "активна (!)",
                "name": (payload.get("name") or "")[:40],
                "published": (payload.get("published_at") or "")[:10],
                "dates": {k: v for k, v in payload.items()
                          if k.endswith("_at") and isinstance(v, str)},
            })

    print(f"{'id':>12} {'стр':4} {'статус':14} {'опубликована':13} должность")
    print("-" * 92)
    for r in rows[:30]:
        print(f"{r['id']:>12} {r['country']:4} {r['status']:14} "
              f"{r.get('published', '—'):13} {r.get('name', '')}")

    print(f"\n{'=' * 92}")
    print(f"доступны по прямой ссылке: {stats['200']} из {len(targets)}")
    print(f"из них archived = true:    {stats['archived']}")
    if stats["404"]:
        print(f"вернули 404:               {stats['404']}")

    print(f"\nполя с датами и упоминанием архива: {sorted(new_fields)}")
    date_fields: dict[str, set[str]] = {}
    for r in rows:
        for k, v in (r.get("dates") or {}).items():
            date_fields.setdefault(k, set()).add(v[:10])
    for field, values in sorted(date_fields.items()):
        sample = sorted(values)[:4]
        print(f"  {field:24} примеры: {', '.join(sample)}")

    print(f"\n{'=' * 92}")
    if stats["archived"] == stats["200"] and stats["200"]:
        print("✓ ВСЕ пропавшие помечены archived — детекция подтверждена источником.")
        print("  Значит, `archived` можно использовать вместо правила двух пропусков")
        print("  и отличать «сняли» от «парсер моргнул».")
    elif stats["archived"]:
        print(f"⚠ archived у {stats['archived']} из {stats['200']} — признак есть,")
        print("  но не у всех. Правило двух пропусков оставить как основное.")
    else:
        print("✗ archived не выставляется — полагаемся только на исчезновение.")

    if not any("archiv" in f for f in new_fields):
        print("\nДаты архивации в ответе API нет — на веб-странице она есть,")
        print("но через API не отдаётся. Время жизни считается по срезам.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
