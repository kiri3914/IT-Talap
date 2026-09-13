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

    -- За какой период указана сумма. Есть только в salary_range.
    -- Без него ставка за смену и месячный оклад попадают в одну медиану:
    -- в данных на 2026-09-14 таких 25 из 1301 (SERVICE, SHIFT, HOUR,
    -- FLY_IN_FLY_OUT). Вакансии без salary_range считаем месячными —
    -- так было до появления поля.
    coalesce(payload -> 'salary_range' -> 'mode' ->> 'id', 'MONTH')
                                                    as salary_mode,

    -- Грейда в данных нет, есть только опыт. По ТЗ §5.4 опыт — основная ось
    (payload -> 'experience' ->> 'id')              as experience_id,
    (payload -> 'experience' ->> 'name')            as experience_name,

    (payload -> 'professional_roles' -> 0 ->> 'id')   as professional_role_id,
    (payload -> 'professional_roles' -> 0 ->> 'name') as professional_role_name,

    -- Формат работы приходит структурно, выводить из текста не нужно
    (payload -> 'work_format' -> 0 ->> 'id')        as work_format,
    (payload -> 'employment_form' ->> 'id')         as employment_form,
    (payload -> 'work_schedule_by_days' -> 0 ->> 'id') as work_schedule,
    (payload -> 'working_hours' -> 0 ->> 'id')      as working_hours,

    -- Город публикации и город работы расходятся у релокационных вакансий:
    -- area = Астана, address.city = Лимасол (findings-03)
    (payload -> 'address' ->> 'city')               as work_city,
    (payload -> 'address' ->> 'lat')::numeric       as work_lat,
    (payload -> 'address' ->> 'lng')::numeric       as work_lng,

    (payload ->> 'published_at')::timestamptz       as published_at,
    -- Не меняется при перепубликации — кандидат в признак для метрики
    (payload ->> 'initial_created_at')::timestamptz as initial_created_at,
    (payload ->> 'archived')::boolean               as is_archived,
    payload ->> 'alternate_url'                     as source_url,

    -- Контакты не сохраняем (ТЗ §10): телефоны и почта вырезаются из текста
    regexp_replace(
        regexp_replace(
            regexp_replace(payload ->> 'description', '<[^>]+>', ' ', 'g'),
            '[\w.+-]+@[\w-]+\.[\w.]+', '[email]', 'g'),
        '\+?\d[\d\s()-]{9,}\d', '[phone]', 'g')     as description_clean

from details
