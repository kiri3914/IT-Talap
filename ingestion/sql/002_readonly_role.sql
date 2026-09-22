-- Общая учётка «только чтение» для команды.
--
-- Пароль здесь НЕ задаётся сознательно: пароль в файле — это пароль в гите,
-- в истории команд и в логах psql. Задаётся отдельно и вручную:
--     \password talap_ro
--
-- Идемпотентно: можно прогонять повторно, в том числе после изменения схем.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'talap_ro') THEN
        CREATE ROLE talap_ro LOGIN PASSWORD NULL;
    END IF;
END
$$;

GRANT CONNECT ON DATABASE talap TO talap_ro;

GRANT USAGE ON SCHEMA raw_landing, staging, core, marts, meta TO talap_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA raw_landing, staging, core, marts, meta TO talap_ro;

-- Без этого права слетят завтра же: dbt каждую ночь пересоздаёт таблицы
-- в staging и marts, а новые таблицы наследуют не текущие гранты, а
-- умолчания того, кто их создал.
ALTER DEFAULT PRIVILEGES FOR ROLE talap IN SCHEMA staging, core, marts
    GRANT SELECT ON TABLES TO talap_ro;

-- Явный запрет на запись в сырьё. Формально роль и так без INSERT, но
-- REVOKE здесь — документация намерения: raw неизменяем, править его
-- нельзя даже случайно.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA raw_landing FROM talap_ro;
