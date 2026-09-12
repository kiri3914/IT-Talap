"""Проверка адаптивной нарезки на большом объёме.

Ветка `_split_by_date` в клиенте hh — самая сложная часть сбора, и на данных
KZ/UZ/KG она НИ РАЗУ не исполнялась: ни один срез `area × professional_role`
не превысил лимит глубины выдачи. Код есть, но не проверен.

Единственное место, где он реально нужен, — Россия: объём там на порядок
больше. Скрипт измеряет, где именно ломается выдача, и подтверждает
или опровергает константу DEPTH_LIMIT.

    .venv/bin/python scripts/check_depth_limit.py
    .venv/bin/python scripts/check_depth_limit.py --country ru --collect
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ingestion.config import HHConfig  # noqa: E402
from ingestion.sources.hh import DEPTH_LIMIT, PER_PAGE, COUNTRIES, HHClient  # noqa: E402

log = logging.getLogger("talap.depth")


def probe_real_limit(client: HHClient, area: str, role: str) -> int | None:
    """Ищет реальную границу: с какой страницы API перестаёт отдавать данные."""
    lo, hi = 0, (DEPTH_LIMIT // PER_PAGE) + 15
    last_ok = None
    while lo <= hi:
        mid = (lo + hi) // 2
        try:
            payload = client._search_page(  # noqa: SLF001
                {"area": area, "professional_role": role}, page=mid
            )
        except Exception as exc:  # noqa: BLE001
            log.debug("страница %d: %s", mid, str(exc)[:120])
            hi = mid - 1
            continue
        if payload.get("items"):
            last_ok = mid
            lo = mid + 1
        else:
            hi = mid - 1
    return (last_ok + 1) * PER_PAGE if last_ok is not None else None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--country", default="ru", choices=sorted(COUNTRIES))
    parser.add_argument("--collect", action="store_true",
                        help="прогнать полный сбор и показать статистику нарезки")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)-7s %(name)s | %(message)s")
    for noisy in ("httpx", "httpcore"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    cfg = HHConfig.from_env()
    with HHClient(cfg) as client:
        area = client.resolve_area_id(COUNTRIES[args.country]["area_name"])
        roles = client.resolve_it_role_ids()
        print(f"{COUNTRIES[args.country]['area_name']} (area={area}), "
              f"константа DEPTH_LIMIT={DEPTH_LIMIT}\n")

        found = {}
        for role in roles:
            payload = client._search_page({"area": area, "professional_role": role}, 0)  # noqa: SLF001
            found[role] = int(payload.get("found", 0))

        over = {r: n for r, n in found.items() if n > DEPTH_LIMIT}
        print(f"{'роль':>6} {'found':>9}  превышает лимит")
        print("-" * 40)
        for role, n in sorted(found.items(), key=lambda kv: -kv[1])[:12]:
            print(f"{role:>6} {n:>9}  {'ДА' if n > DEPTH_LIMIT else ''}")
        print(f"\nвсего IT-вакансий: {sum(found.values())}")
        print(f"срезов выше лимита: {len(over)} из {len(found)}")

        if not over:
            print("\nНарезка по датам не потребуется даже здесь — "
                  "проверить её на реальных данных не получится.")
            return 0

        biggest = max(over, key=over.get)
        print(f"\nИзмеряю реальную границу на роли {biggest} (found={over[biggest]})…")
        real = probe_real_limit(client, area, biggest)
        if real is None:
            print("  не удалось определить")
        else:
            print(f"  API отдаёт максимум ~{real} результатов")
            if real != DEPTH_LIMIT:
                print(f"  ⚠ КОНСТАНТА НЕВЕРНА: в коде {DEPTH_LIMIT}, по факту {real}")
                print(f"    поправить DEPTH_LIMIT в ingestion/sources/hh.py")
            else:
                print(f"  ✓ константа подтверждена")

        if args.collect:
            print("\nПолный сбор с нарезкой…")
            items = client.fetch_country_list(args.country)
            st = client.stats
            print(f"  собрано:            {len(items)}")
            print(f"  запросов:           {st.requests}")
            print(f"  делений окна:       {st.windows_split}")
            if st.truncated_slices:
                print(f"  ⚠ не влезло: {st.truncated_slices}")
            else:
                print("  ✓ все срезы забраны полностью")
            expected = sum(found.values())
            print(f"  ожидалось ~{expected}, разница {len(items) - expected:+}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
