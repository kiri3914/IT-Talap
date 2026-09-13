"""Утренняя проверка: отработал ли сбор и что с данными.

Одна команда вместо пяти. Смотрит бакет, логи, Postgres и считает оборот.

    .venv/bin/python scripts/daily_check.py
"""

from __future__ import annotations

import re
import sys
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ingestion.config import S3Config  # noqa: E402
from ingestion.storage.s3 import RawStorage  # noqa: E402

LOG_DIR = Path.home() / "logs"
OK, WARN, BAD = "✓", "⚠", "✗"


def head(title: str) -> None:
    print(f"\n{'=' * 64}\n{title}\n{'=' * 64}")


def check_bucket(storage: RawStorage) -> list[str]:
    head("БАКЕТ")
    sizes: dict[tuple[str, str], int] = defaultdict(int)
    dates: set[str] = set()
    for key in storage.list_keys("raw/hh/"):
        m = re.search(r"country=(\w+)/dt=([\d-]+)", key)
        if m:
            sizes[(m.group(2), m.group(1))] += 1
            dates.add(m.group(2))

    ordered = sorted(dates)
    for dt in ordered:
        row = "  ".join(f"{c}={sizes[(dt, c)]:>2}" for c in ("kz", "uz", "kg"))
        print(f"  {dt}   файлов: {row}")

    if len(ordered) > 1:
        first, last = date.fromisoformat(ordered[0]), date.fromisoformat(ordered[-1])
        expected = {(first + timedelta(days=i)).isoformat()
                    for i in range((last - first).days + 1)}
        missing = sorted(expected - dates)
        if missing:
            print(f"\n  {BAD} ПРОПУЩЕНЫ ДНИ: {', '.join(missing)}")
            print("     Бэкфилл невозможен — hh не отдаёт прошлую выдачу.")
        else:
            print(f"\n  {OK} без пропусков: {ordered[0]} … {ordered[-1]} ({len(ordered)} дн.)")

    today = date.today().isoformat()
    if today not in dates:
        print(f"  {WARN} за сегодня ({today}) данных ещё нет")
    return ordered


def check_log() -> None:
    head("ЛОГ ПОСЛЕДНЕГО ПРОГОНА")
    logs = sorted(LOG_DIR.glob("talap-*.log")) if LOG_DIR.exists() else []
    if not logs:
        print(f"  {WARN} логов нет в {LOG_DIR} — cron ещё не отрабатывал?")
        return

    lines = logs[-1].read_text(encoding="utf-8", errors="replace").splitlines()
    print(f"  файл: {logs[-1].name}, строк: {len(lines)}")

    failed = [ln for ln in lines if "FAILED" in ln or "ERROR" in ln]
    print(f"  {BAD if failed else OK} ошибок: {len(failed)}")
    for ln in failed[-3:]:
        print(f"     {ln[:150]}")

    for marker, label in (("деталей к загрузке", "оборот"), ("итог:", "итог")):
        found = [ln for ln in lines if marker in ln]
        if found:
            print(f"\n  {label}:")
            for ln in found[-4:]:
                print(f"     {ln.split('|')[-1].strip()[:130]}")


def check_turnover(storage: RawStorage, dates: list[str]) -> None:
    if len(dates) < 2:
        print("\n  недостаточно дат для расчёта оборота")
        return
    head(f"ОБОРОТ: {dates[-2]} → {dates[-1]}")

    def ids(dt: str, country: str) -> set[str]:
        out: set[str] = set()
        prefix = f"raw/hh/country={country}/dt={dt}/vacancies_list-"
        for key in storage.list_keys(prefix):
            out |= {str(i["id"]) for i in (storage.read_json(key) or []) if i.get("id")}
        return out

    print(f"  {'стр':4} {'было':>6} {'стало':>6} {'ушло':>6} {'новых':>6} "
          f"{'% выбытия':>10} {'ср. жизнь':>10}")
    print("  " + "-" * 60)
    for country in ("kz", "uz", "kg"):
        before, after = ids(dates[-2], country), ids(dates[-1], country)
        if not before:
            continue
        gone, new = before - after, after - before
        rate = len(gone) / len(before)
        life = f"{1 / rate:.0f} дн." if rate else "—"
        print(f"  {country:4} {len(before):>6} {len(after):>6} {len(gone):>6} "
              f"{len(new):>6} {100 * rate:>9.2f}% {life:>10}")

    print("\n  Средняя жизнь — грубая оценка 1/доля_выбытия за сутки.")
    print("  Достоверна, только если снимки сняты с разницей ровно в сутки.")


def main() -> int:
    storage = RawStorage(S3Config.from_env())
    dates = check_bucket(storage)
    check_log()
    check_turnover(storage, dates)

    head("ЧТО ДАЛЬШЕ")
    print("  .venv/bin/python -m ingestion.load_to_postgres   загрузить новые дни")
    print("  .venv/bin/python scripts/salary_report.py --usd  зарплаты в долларах")
    print("  .venv/bin/python scripts/market_trend.py         динамика доли IT")
    return 0


if __name__ == "__main__":
    sys.exit(main())
