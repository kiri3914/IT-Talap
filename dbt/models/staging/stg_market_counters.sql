-- Счётчики рынка: сколько всего вакансий и сколько IT по странам на дату.
-- Механическая распаковка, никакой логики.

select
    dt,
    country,
    vacancies_total,
    vacancies_it,
    it_share,
    by_role
from {{ source('raw_landing', 'market_counters') }}
