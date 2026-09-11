"""Догрузка курсов валют за прошлые даты.

В отличие от вакансий, курсы историчны: нацбанки отдают их за любую дату.
Поэтому для них бэкфилл осмыслен, а для выдачи вакансий — нет.

    python -m ingestion.backfill_rates --dt 2026-09-11
    python -m ingestion.backfill_rates --from 2026-09-01 --to 2026-09-11
"""

from __future__ import annotations

import argparse
import logging
import sys
from datetime import date, timedelta

from ingestion.config import HHConfig, S3Config
from ingestion.sources.currency import fetch_rates
from ingestion.storage.s3 import RawStorage

log = logging.getLogger("talap.rates")


def main() -> int:
    parser = argparse.ArgumentParser(description="Talap — догрузка курсов за прошлые даты")
    parser.add_argument("--dt", action="append")
    parser.add_argument("--from", dest="date_from")
    parser.add_argument("--to", dest="date_to")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)-7s %(name)s | %(message)s")
    for noisy in ("httpx", "httpcore", "botocore", "boto3", "urllib3"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    if args.dt:
        dates = [date.fromisoformat(d) for d in args.dt]
    elif args.date_from and args.date_to:
        start, end = date.fromisoformat(args.date_from), date.fromisoformat(args.date_to)
        dates = [start + timedelta(days=i) for i in range((end - start).days + 1)]
    else:
        dates = [date.today()]

    storage = RawStorage(S3Config.from_env())
    user_agent = HHConfig.from_env().user_agent

    for d in dates:
        try:
            rates = fetch_rates(d, user_agent)
            storage.write_json(f"raw/currency/dt={d.isoformat()}/rates-000.json.gz", rates)
        except Exception as exc:  # noqa: BLE001
            log.error("%s: не собрались — %s", d, exc)
    return 0


if __name__ == "__main__":
    sys.exit(main())
