-- Курсы к USD на дату. RUR уже приведён к RUB на этапе сбора,
-- но алиас может встретиться в старых партициях — приводим ещё раз.

select
    dt,
    case when currency = 'RUR' then 'RUB' else currency end as currency,
    rate,                                    -- единиц валюты за 1 USD
    source
from {{ source('raw_landing', 'currency_rates') }}
where rate > 0
