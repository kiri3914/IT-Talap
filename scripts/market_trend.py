"""Динамика рынка по сохранённым счётчикам.

Показывает, как меняются общее число вакансий, число IT и доля IT —
метрика, которой нет ни у одной площадки, потому что никто не хранит срезы.

    .venv/bin/python scripts/market_trend.py
    .venv/bin/python scripts/market_trend.py --roles    # спрос по профессиям
"""

from __future__ import annotations

import argparse
import re
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ingestion.config import S3Config  # noqa: E402
from ingestion.storage.s3 import RawStorage  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--roles", action="store_true", help="разбивка по профессиям")
    args = parser.parse_args()

    storage = RawStorage(S3Config.from_env())
    keys = [k for k in storage.list_keys("raw/hh/") if "market_counters" in k]
    if not keys:
        print("счётчиков пока нет — они появятся после следующего ночного прогона")
        return 0

    rows = []
    for key in sorted(keys):
        data = storage.read_json(key)
        if data:
            rows.append(data)

    if args.roles:
        by_role: dict[str, dict[str, int]] = defaultdict(dict)
        for r in rows:
            for role_id, n in (r.get("by_role") or {}).items():
                by_role[role_id][f"{r['dt']}/{r['country']}"] = n
        print("спрос по ролям (found на дату)\n")
        for role_id, series in sorted(by_role.items()):
            line = "  ".join(f"{k}={v}" for k, v in sorted(series.items()))
            print(f"  role {role_id:>4}: {line}")
        return 0

    print(f"{'дата':12} {'стр':4} {'всего':>8} {'IT':>7} {'доля IT':>9} {'Δ всего':>9} {'Δ IT':>8}")
    print("-" * 62)

    prev: dict[str, dict] = {}
    for r in sorted(rows, key=lambda x: (x["dt"], x["country"])):
        c = r["country"]
        d_total = d_it = ""
        if c in prev:
            d_total = f"{r['vacancies_total'] - prev[c]['vacancies_total']:+}"
            d_it = f"{r['vacancies_it'] - prev[c]['vacancies_it']:+}"
        share = f"{100 * r['it_share']:.2f}%" if r.get("it_share") else "—"
        print(
            f"{r['dt']:12} {c:4} {r['vacancies_total']:>8} {r['vacancies_it']:>7} "
            f"{share:>9} {d_total:>9} {d_it:>8}"
        )
        prev[c] = r

    if len({r["dt"] for r in rows}) < 2:
        print("\nОдна дата — динамики пока нет. Вернитесь через пару дней.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
