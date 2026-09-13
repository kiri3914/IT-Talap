-- Курсы к USD на дату.
--
-- hh отдаёт код RUR, а нацбанки RUB. При сборе мы пишем обе записи
-- (RUR как алиас), чтобы джойн сошёлся с любой стороны. Здесь приводим
-- к одному коду — и тогда на дату получается два RUB, что ломает
-- уникальность ключа. Поэтому оставляем по одной записи на (дата, валюта),
-- предпочитая канонический RUB.

select distinct on (dt, currency_code)
    dt,
    currency_code                                as currency,
    rate,                                        -- единиц валюты за 1 USD
    source
from (
    select
        dt,
        case when currency = 'RUR' then 'RUB' else currency end as currency_code,
        currency                                 as currency_raw,
        rate,
        source
    from {{ source('raw_landing', 'currency_rates') }}
    where rate > 0
) t
-- При равенстве выигрывает запись с исходным кодом RUB, а не алиасом RUR
order by dt, currency_code, (currency_raw = 'RUR')
