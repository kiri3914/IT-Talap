"""Курсы валют из национальных банков.

Без них главная фича продукта — сравнение стран — не работает:
30% зарплатной выборки приходится на UZS и KGS.

Опорная валюта USD. Курс каждой валюты берётся из её собственного
нацбанка: это защитимее, чем кросс-курс через третью валюту, и совпадает
с тем, на что ориентируется работодатель, публикующий вилку.

Источники проверены 2026-09-12:
  KZT  Нацбанк РК              XML,  48 валют
  UZS  ЦБ Узбекистана          JSON, 74 валюты
  KGS  Нацбанк Кыргызстана     XML,  windows-1251
  RUB, EUR — кросс через НБ РК (в выборке 1.7%, свой источник избыточен)

ЦБ РФ (cbr.ru) не отвечает с сервера сбора — таймаут. Не используем.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import date

import httpx

log = logging.getLogger(__name__)

NBK_URL = "https://nationalbank.kz/rss/get_rates.cfm"
CBU_URL = "https://cbu.uz/ru/arkhiv-kursov-valyut/json/"
NBKR_URL = "https://www.nbkr.kg/XML/daily.xml"

_NBK_ITEM = re.compile(
    r"<item>.*?<title>(\w+)</title>.*?<description>([\d.]+)</description>"
    r".*?<quant>(\d+)</quant>.*?</item>",
    re.S,
)
_NBKR_ITEM = re.compile(
    r'ISOCode="(\w+)">\s*<Nominal>(\d+)</Nominal>\s*<Value>([\d,]+)</Value>'
)


def _get(client: httpx.Client, url: str, **kwargs) -> httpx.Response:
    response = client.get(url, timeout=30.0, **kwargs)
    response.raise_for_status()
    return response


def fetch_nbk(client: httpx.Client, on: date) -> dict[str, float]:
    """Нацбанк РК: сколько тенге за единицу валюты."""
    text = _get(client, NBK_URL, params={"fdate": on.strftime("%d.%m.%Y")}).text
    return {
        code: value / int(quant)
        for code, raw, quant in _NBK_ITEM.findall(text)
        if (value := float(raw))
    }


def fetch_cbu(client: httpx.Client) -> dict[str, float]:
    """ЦБ Узбекистана: сколько сумов за единицу валюты."""
    payload = json.loads(_get(client, CBU_URL).text)
    return {
        r["Ccy"]: float(r["Rate"]) / float(r.get("Nominal") or 1)
        for r in payload
        if r.get("Rate")
    }


def fetch_nbkr(client: httpx.Client) -> dict[str, float]:
    """Нацбанк Кыргызстана: сколько сомов за единицу валюты."""
    raw = _get(client, NBKR_URL).content.decode("windows-1251")
    return {
        code: float(value.replace(",", ".")) / int(nominal)
        for code, nominal, value in _NBKR_ITEM.findall(raw)
    }


def fetch_rates(on: date, user_agent: str) -> dict:
    """Курсы к USD на дату. Ошибка одного источника не роняет остальные."""
    rates: dict[str, float] = {"USD": 1.0}
    sources: dict[str, str] = {}
    errors: dict[str, str] = {}

    with httpx.Client(headers={"User-Agent": user_agent}, follow_redirects=True) as client:
        nbk: dict[str, float] = {}
        try:
            nbk = fetch_nbk(client, on)
            if usd_kzt := nbk.get("USD"):
                rates["KZT"] = usd_kzt
                sources["KZT"] = "nationalbank.kz"
                # EUR и RUB — кросс через тенге: вместе они 1.7% выборки
                for code in ("EUR", "RUB"):
                    if per_kzt := nbk.get(code):
                        rates[code] = usd_kzt / per_kzt
                        sources[code] = "nationalbank.kz (кросс через KZT)"
        except Exception as exc:  # noqa: BLE001
            errors["KZT"] = str(exc)[:200]

        try:
            if usd_uzs := fetch_cbu(client).get("USD"):
                rates["UZS"] = usd_uzs
                sources["UZS"] = "cbu.uz"
        except Exception as exc:  # noqa: BLE001
            errors["UZS"] = str(exc)[:200]
            if per_kzt := nbk.get("UZS"):  # запасной вариант — кросс через тенге
                rates["UZS"] = nbk["USD"] / per_kzt
                sources["UZS"] = "nationalbank.kz (запасной кросс)"

        try:
            if usd_kgs := fetch_nbkr(client).get("USD"):
                rates["KGS"] = usd_kgs
                sources["KGS"] = "nbkr.kg"
        except Exception as exc:  # noqa: BLE001
            errors["KGS"] = str(exc)[:200]
            if per_kzt := nbk.get("KGS"):
                rates["KGS"] = nbk["USD"] / per_kzt
                sources["KGS"] = "nationalbank.kz (запасной кросс)"

    # hh отдаёт код RUR, а не RUB — иначе джойн со справочником не сойдётся
    if "RUB" in rates:
        rates["RUR"] = rates["RUB"]
        sources["RUR"] = sources["RUB"] + " (алиас RUB: hh отдаёт RUR)"

    missing = {"KZT", "UZS", "KGS"} - set(rates)
    if missing:
        log.warning("нет курсов: %s", ", ".join(sorted(missing)))

    log.info(
        "курсы на %s: %s",
        on,
        ", ".join(f"{c}={v:.4g}" for c, v in sorted(rates.items()) if c != "RUR"),
    )
    return {
        "dt": on.isoformat(),
        "base": "USD",
        "rates": rates,       # сколько единиц валюты за 1 USD
        "sources": sources,
        "errors": errors,
    }
