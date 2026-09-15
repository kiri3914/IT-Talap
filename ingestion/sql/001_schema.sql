-- Схемы слоёв. raw_landing — посадочная площадка для сырья из бакета:
-- JSON как есть, без разбора. Типизация начинается в staging (dbt).
CREATE SCHEMA IF NOT EXISTS raw_landing;
CREATE SCHEMA IF NOT EXISTS staging;
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS marts;
CREATE SCHEMA IF NOT EXISTS meta;

-- Журнал загрузок. ТЗ §8.2: без него через три месяца невозможно
-- объяснить провалы в данных.
CREATE TABLE IF NOT EXISTS meta.ingestion_log (
    run_id          bigserial PRIMARY KEY,
    source          text        NOT NULL,
    country         text,
    dt              date        NOT NULL,
    kind            text        NOT NULL,
    started_at      timestamptz NOT NULL,
    finished_at     timestamptz,
    status          text        NOT NULL,
    records_fetched int,
    records_written int,
    error_message   text
);
CREATE INDEX IF NOT EXISTS ix_ingestion_log_dt ON meta.ingestion_log (dt, source);

-- Вакансии hh как есть. Уникальность по (source_id, dt) — идемпотентность:
-- повторная загрузка той же партиции обновляет, а не плодит дубли.
CREATE TABLE IF NOT EXISTS raw_landing.hh_vacancies (
    source_id   text        NOT NULL,
    country     text        NOT NULL,
    dt          date        NOT NULL,
    kind        text        NOT NULL,   -- list | details
    payload     jsonb       NOT NULL,
    loaded_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (source_id, dt, kind)
);
CREATE INDEX IF NOT EXISTS ix_hh_vacancies_dt ON raw_landing.hh_vacancies (dt, country);

-- Для dbt source freshness: он делает max(loaded_at). При нынешних 13k строк
-- планировщик всё равно берёт seq scan — индекс заведён на вырост.
CREATE INDEX IF NOT EXISTS ix_hh_vacancies_loaded_at
    ON raw_landing.hh_vacancies (loaded_at DESC);

-- Посты телеграма. Ключ (channel, message_id) — единственный стабильный
-- идентификатор, который даёт источник.
CREATE TABLE IF NOT EXISTS raw_landing.telegram_posts (
    channel     text        NOT NULL,
    message_id  bigint      NOT NULL,
    dt          date        NOT NULL,
    country     text,
    payload     jsonb       NOT NULL,
    loaded_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (channel, message_id)
);
CREATE INDEX IF NOT EXISTS ix_telegram_posts_dt ON raw_landing.telegram_posts (dt);

-- Счётчики рынка: сколько всего вакансий и сколько IT по странам.
-- Невосстановимо задним числом — площадка историю не отдаёт.
CREATE TABLE IF NOT EXISTS raw_landing.market_counters (
    dt              date    NOT NULL,
    country         text    NOT NULL,
    vacancies_total int     NOT NULL,
    vacancies_it    int     NOT NULL,
    it_share        numeric(8, 5),
    by_role         jsonb,
    PRIMARY KEY (dt, country)
);

-- Курсы к USD на дату.
CREATE TABLE IF NOT EXISTS raw_landing.currency_rates (
    dt        date    NOT NULL,
    currency  char(3) NOT NULL,
    rate      numeric(20, 6) NOT NULL,  -- единиц валюты за 1 USD
    source    text,
    PRIMARY KEY (dt, currency)
);
