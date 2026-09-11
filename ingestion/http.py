"""HTTP-клиент с backoff. Общий для всех источников."""

from __future__ import annotations

import logging
import random
import time
from typing import Any

import httpx

log = logging.getLogger(__name__)

RETRY_STATUSES = {429, 500, 502, 503, 504}
MAX_ATTEMPTS = 6


class RateLimitedClient:
    """httpx с экспоненциальным backoff на 429 и 5xx (ТЗ §3.3)."""

    def __init__(self, base_url: str, headers: dict[str, str], min_interval: float = 0.2) -> None:
        self._client = httpx.Client(
            base_url=base_url,
            headers=headers,
            timeout=httpx.Timeout(30.0, connect=10.0),
            follow_redirects=True,
        )
        self._min_interval = min_interval
        self._last_call = 0.0

    def _throttle(self) -> None:
        elapsed = time.monotonic() - self._last_call
        if elapsed < self._min_interval:
            time.sleep(self._min_interval - elapsed)
        self._last_call = time.monotonic()

    def get_json(self, path: str, params: dict[str, Any] | None = None) -> Any:
        last_exc: Exception | None = None
        for attempt in range(1, MAX_ATTEMPTS + 1):
            self._throttle()
            try:
                response = self._client.get(path, params=params)
            except httpx.HTTPError as exc:
                last_exc = exc
                log.warning("сетевая ошибка %s (попытка %d): %s", path, attempt, exc)
            else:
                if response.status_code == 200:
                    return response.json()
                if response.status_code not in RETRY_STATUSES:
                    # Тело ответа объясняет причину — без него 400 неотличим от 400
                    raise RuntimeError(
                        f"{response.status_code} на {path} "
                        f"params={params} -> {response.text[:500]}"
                    )
                last_exc = httpx.HTTPStatusError(
                    f"{response.status_code} на {path}",
                    request=response.request,
                    response=response,
                )
                retry_after = response.headers.get("Retry-After")
                if retry_after and retry_after.isdigit():
                    delay = float(retry_after)
                    log.warning("%s: Retry-After %.0fs", response.status_code, delay)
                    time.sleep(delay)
                    continue
                log.warning("%s на %s (попытка %d)", response.status_code, path, attempt)

            if attempt < MAX_ATTEMPTS:
                delay = min(2**attempt, 60) + random.uniform(0, 1)
                time.sleep(delay)

        raise RuntimeError(f"не удалось получить {path} за {MAX_ATTEMPTS} попыток") from last_exc

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> RateLimitedClient:
        return self

    def __exit__(self, *args: object) -> None:
        self.close()
