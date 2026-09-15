#!/usr/bin/env bash
# Ночной прогон: сбор -> загрузка в Postgres -> витрины -> копия сырья.
#
# Одним скриптом, а не тремя заданиями cron: порядок важен. Загружать
# нечего, пока не собрано; считать нечего, пока не загружено.
#
# Шаги не обрываются друг об друга без нужды:
#   сбор упал      -> загрузку всё равно пробуем: вчерашнее могло не доехать
#   загрузка упала -> dbt пропускаем, считать не из чего
#   копия наружу   -> последним шагом, от неё ничего не зависит
#
# Про set -e здесь намеренно НЕТ: падение одного шага не должно
# уносить весь прогон молча. Каждый шаг проверяется явно.
set -uo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VENV="$APP_DIR/.venv/bin/python"
cd "$APP_DIR"

STARTED=$(date '+%Y-%m-%d %H:%M:%S')
FAILED=()

step() {
    local name="$1"; shift
    echo ""
    echo "───── $name · $(date '+%H:%M:%S') ─────"
    if "$@"; then
        echo "───── $name: готово ─────"
        return 0
    fi
    echo "───── $name: ОШИБКА (код $?) ─────"
    FAILED+=("$name")
    return 1
}

echo "═════ ночной прогон $STARTED ═════"

step "сбор hh"            "$VENV" -m ingestion.run
collected=$?

step "загрузка в Postgres" "$VENV" -m ingestion.load_to_postgres
loaded=$?

if [ "$loaded" -eq 0 ]; then
    step "витрины dbt" bash "$APP_DIR/scripts/dbt.sh" build
else
    echo ""
    echo "───── витрины dbt: пропущены, загрузка не прошла ─────"
    FAILED+=("витрины dbt (пропущены)")
fi

# Копия наружу — последним шагом: она ничего не блокирует, но и не должна
# молча пропадать. Если BACKUP_REMOTE пуст, скрипт сам выйдет с нулём.
step "копия сырья наружу" bash "$APP_DIR/scripts/backup_raw.sh"

echo ""
echo "═════ итог $(date '+%H:%M:%S') ═════"
if [ ${#FAILED[@]} -eq 0 ]; then
    echo "все шаги прошли"
    exit 0
fi

echo "не прошло: ${FAILED[*]}"
# Алерт шлём сами: ingestion.run сообщает только о своих падениях,
# про загрузку и dbt он ничего не знает
"$VENV" - <<PY
from ingestion.alerts import send
from ingestion.config import AlertConfig
send(AlertConfig.from_env(),
     "🔴 Talap · ночной прогон ${STARTED}\nНе прошло: ${FAILED[*]}\n"
     "Лог: ~/logs/talap-\$(date +%Y-%m).log")
PY
exit 1
