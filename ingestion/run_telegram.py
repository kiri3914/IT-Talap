"""Сбор постов из публичных Telegram-каналов.

Отдельная точка входа, а не источник в ingest_daily: у телеграма другая
форма данных (поток постов, а не снимок выдачи) и другой риск-профиль.
Падение здесь не должно влиять на основной сбор.

    python -m ingestion.run_telegram
    python -m ingestion.run_telegram --channel workitkz --max-posts 500
"""

from __future__ import annotations

import argparse
import logging
import sys
from datetime import UTC, date, datetime

from ingestion.alerts import send as send_alert
from ingestion.config import AlertConfig, HHConfig, S3Config
from ingestion.sources.telegram import CHANNELS, TelegramClient
from ingestion.storage.s3 import RawStorage

log = logging.getLogger("talap.telegram")

SOURCE = "telegram"
CHUNK_SIZE = 200


def ingest_channel(
    channel: str, dt: str, storage: RawStorage, client: TelegramClient, max_posts: int
) -> dict:
    posts = client.fetch_channel(channel, max_posts=max_posts)
    meta = CHANNELS.get(channel, {})
    for post in posts:
        post["country"] = meta.get("country")
        post["collected_at"] = datetime.now(UTC).isoformat()

    prefix = f"raw/{SOURCE}/channel={channel}/dt={dt}/"
    storage.delete_prefix(prefix)
    for part in range(0, len(posts), CHUNK_SIZE):
        storage.write_json(
            RawStorage.channel_key(SOURCE, channel, dt, part // CHUNK_SIZE),
            posts[part : part + CHUNK_SIZE],
        )

    newest = posts[0]["published_at"][:10] if posts else None
    return {"channel": channel, "posts": len(posts), "newest": newest, "status": "success"}


def main() -> int:
    parser = argparse.ArgumentParser(description="Talap — сбор Telegram-каналов")
    parser.add_argument("--channel", action="append", choices=sorted(CHANNELS))
    parser.add_argument("--dt", default=date.today().isoformat())
    parser.add_argument("--max-posts", type=int, default=200)
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s | %(message)s",
    )
    for noisy in ("httpx", "httpcore", "botocore", "boto3", "urllib3", "s3transfer"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    storage = RawStorage(S3Config.from_env())
    alerts = AlertConfig.from_env()
    user_agent = HHConfig.from_env().user_agent

    results = []
    failed = False
    with TelegramClient(user_agent) as client:
        for channel in args.channel or sorted(CHANNELS):
            try:
                results.append(
                    ingest_channel(channel, args.dt, storage, client, args.max_posts)
                )
            except Exception as exc:  # noqa: BLE001 — канал не должен ронять остальные
                failed = True
                log.exception("%s: сбор упал", channel)
                results.append({"channel": channel, "status": "failed", "error": str(exc)})
                send_alert(alerts, f"🔴 Talap / telegram / {channel} {args.dt}\n{exc}")

    summary = " | ".join(
        f"{r['channel']}: {r['posts']}" if r["status"] == "success" else f"{r['channel']}: FAILED"
        for r in results
    )
    log.info("telegram %s — %s", args.dt, summary)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
