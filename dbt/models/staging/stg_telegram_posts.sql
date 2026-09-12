-- Посты телеграм-каналов. Стабильного ID вакансии у источника нет —
-- есть только (channel, message_id). Извлечение полей из текста живёт
-- в enrichment/telegram_fields.py: правила там объёмнее, чем разумно
-- держать в SQL, и покрыты тестами.
--
-- Здесь только то, что приходит структурно.

select
    channel,
    message_id,
    channel || '/' || message_id::text            as source_id,
    'telegram'                                     as source,
    country,
    dt,
    (payload ->> 'published_at')::timestamptz      as published_at,
    (payload ->> 'views')::int                     as views,
    payload ->> 'url'                              as source_url,
    payload ->> 'text'                             as post_text,
    payload -> 'hashtags'                          as hashtags
from {{ source('raw_landing', 'telegram_posts') }}
