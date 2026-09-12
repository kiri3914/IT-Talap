-- Доля IT во всех вакансиях страны.
--
-- Метрику не публикует ни одна площадка: для неё нужны ежедневные срезы,
-- которых никто не хранит. Считается из счётчиков, собираемых с 2026-09-12.
--
-- Скользящее среднее за 7 дней нужно не только для сглаживания:
-- по нему же работает проверка объёма из ТЗ §8.1 — отклонение больше
-- 40% означает, что со сбором что-то не так.

{{ config(materialized='table') }}

with daily as (
    select
        dt,
        country,
        vacancies_total,
        vacancies_it,
        it_share
    from {{ ref('stg_market_counters') }}
),

windowed as (
    select
        *,
        avg(vacancies_it) over w      as it_avg_7d,
        avg(vacancies_total) over w   as total_avg_7d,
        lag(vacancies_it) over (partition by country order by dt)    as it_prev,
        lag(vacancies_total) over (partition by country order by dt) as total_prev
    from daily
    window w as (
        partition by country order by dt
        rows between 6 preceding and current row
    )
)

select
    dt,
    country,
    vacancies_total,
    vacancies_it,
    it_share,

    vacancies_it    - it_prev                      as it_change,
    vacancies_total - total_prev                   as total_change,

    round(it_avg_7d)                               as it_avg_7d,
    round(total_avg_7d)                            as total_avg_7d,

    -- Отклонение от скользящего среднего: основа алерта из ТЗ §8.1
    case
        when it_avg_7d > 0
        then round(((vacancies_it - it_avg_7d) / it_avg_7d)::numeric, 4)
    end                                            as it_deviation,

    case
        when it_avg_7d > 0 and abs(vacancies_it - it_avg_7d) / it_avg_7d > 0.4
        then true else false
    end                                            as is_volume_anomaly

from windowed
