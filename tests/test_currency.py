"""Тесты разбора курсов из нацбанков."""

from __future__ import annotations

import httpx
import pytest

from ingestion.sources.currency import fetch_cbu, fetch_nbk, fetch_nbkr

NBK_XML = """<?xml version="1.0" encoding="utf-8"?>
<rates><date>11.09.2026</date>
<item><fullname>ДОЛЛАР США</fullname><title>USD</title>
  <description>450.79</description><quant>1</quant></item>
<item><fullname>УЗБЕКСКИЙ СУМ</fullname><title>UZS</title>
  <description>3.83</description><quant>100</quant></item>
<item><fullname>РОССИЙСКИЙ РУБЛЬ</fullname><title>RUB</title>
  <description>5.31</description><quant>1</quant></item>
</rates>"""

CBU_JSON = """[{"Ccy":"USD","Rate":"11783.47","Nominal":"1","Date":"11.09.2026"},
{"Ccy":"EUR","Rate":"13688.86","Nominal":"1","Date":"11.09.2026"}]"""

NBKR_XML = (
    '<?xml version="1.0" encoding="windows-1251" ?>'
    '<CurrencyRates Date="12.09.2026">'
    '<Currency ISOCode="USD"><Nominal>1</Nominal><Value>87,4500</Value></Currency>'
    '<Currency ISOCode="KZT"><Nominal>1</Nominal><Value>0,1940</Value></Currency>'
    "</CurrencyRates>"
)


def client_returning(content: bytes | str, encoding: str = "utf-8") -> httpx.Client:
    body = content if isinstance(content, bytes) else content.encode(encoding)
    transport = httpx.MockTransport(lambda req: httpx.Response(200, content=body))
    return httpx.Client(transport=transport)


def test_nbk_учитывает_номинал():
    with client_returning(NBK_XML) as client:
        rates = fetch_nbk(client, __import__("datetime").date(2026, 9, 11))
    assert rates["USD"] == 450.79
    # 3.83 за 100 сумов -> 0.0383 за один
    assert rates["UZS"] == pytest.approx(0.0383)
    assert rates["RUB"] == 5.31


def test_cbu_разбирает_json():
    with client_returning(CBU_JSON) as client:
        rates = fetch_cbu(client)
    assert rates["USD"] == pytest.approx(11783.47)


def test_nbkr_разбирает_windows1251_и_запятую():
    with client_returning(NBKR_XML.encode("windows-1251")) as client:
        rates = fetch_nbkr(client)
    assert rates["USD"] == pytest.approx(87.45)
    assert rates["KZT"] == pytest.approx(0.194)
