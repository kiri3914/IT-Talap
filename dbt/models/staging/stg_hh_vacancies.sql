-- ОБРАЗЕЦ. Показывает принятый в проекте стиль staging-модели:
--   • из jsonb достаются только нужные поля, с явным приведением типов
--   • никакой бизнес-логики: она в core
--   • контакты вырезаются здесь (ТЗ §10), в raw они остаются
--
-- Остальные staging-модели и весь core пишутся вручную — это целевые
-- компетенции проекта (ТЗ §12.1), а не то, что стоит делегировать.

with details as (
    select
        source_id,
        country,
        dt,
        payload
    from {{ source('raw_landing', 'hh_vacancies') }}
    where kind = 'details'
)

select
    source_id,
    'hh'                                            as source,
    country,
    dt,

    payload ->> 'name'                              as title_original,
    (payload -> 'employer' ->> 'id')                as employer_id,
    (payload -> 'employer' ->> 'name')              as employer_name,

    (payload -> 'area'  ->> 'name')                 as city,
    (payload -> 'area'  ->> 'id')                   as area_id,

    -- У hh два поля зарплаты, оба могут быть null (docs/data_notes.md §2).
    -- Читаем оба: если смотреть только на salary, часть вилок теряется.
    coalesce(payload -> 'salary', payload -> 'salary_range')      as salary_raw,
    (coalesce(payload -> 'salary', payload -> 'salary_range') ->> 'from')::numeric
                                                    as salary_from,
    (coalesce(payload -> 'salary', payload -> 'salary_range') ->> 'to')::numeric
                                                    as salary_to,
    -- hh отдаёт код RUR, а не RUB — приводим, иначе не сойдётся джойн с курсами
    nullif(replace(
        coalesce(payload -> 'salary', payload -> 'salary_range') ->> 'currency',
        'RUR', 'RUB'), '')                          as salary_currency,
    (coalesce(payload -> 'salary', payload -> 'salary_range') ->> 'gross')::boolean
                                                    as salary_gross,

    -- Грейда в данных нет, есть только опыт. По ТЗ §5.4 опыт — основная ось
    (payload -> 'experience' ->> 'id')              as experience_id,
    (payload -> 'experience' ->> 'name')            as experience_name,

    (payload -> 'professional_roles' -> 0 ->> 'id')   as professional_role_id,
    (payload -> 'professional_roles' -> 0 ->> 'name') as professional_role_name,

    (payload ->> 'published_at')::timestamptz       as published_at,
    (payload ->> 'archived')::boolean               as is_archived,
    payload ->> 'alternate_url'                     as source_url,

    -- Контакты не сохраняем (ТЗ §10): телефоны и почта вырезаются из текста
    regexp_replace(
        regexp_replace(
            regexp_replace(payload ->> 'description', '<[^>]+>', ' ', 'g'),
            '[\w.+-]+@[\w-]+\.[\w.]+', '[email]', 'g'),
        '\+?\d[\d\s()-]{9,}\d', '[phone]', 'g')     as description_clean

from details
