#!/usr/bin/env bash
# Ставит ночной прогон в cron. Повторный запуск обновляет задание,
# а не плодит дубли: управляемый блок ограничен маркерами.
set -euo pipefail

APP_DIR="$HOME/talap"
LOG_DIR="$HOME/logs"
BEGIN="# >>> talap >>>"
END="# <<< talap <<<"

mkdir -p "$LOG_DIR"

BLOCK="$BEGIN
# Сбор, загрузка в Postgres и пересчёт витрин. Один скрипт, а не три
# задания: порядок важен. Правится через scripts/install_cron.sh.
0 3 * * * cd $APP_DIR && bash scripts/nightly.sh >> $LOG_DIR/talap-\$(date +\\%Y-\\%m).log 2>&1
$END"

# Вырезаем прежний блок и всё, что ставилось до появления маркеров
current=$(crontab -l 2>/dev/null || true)
cleaned=$(printf '%s\n' "$current" \
    | awk -v b="$BEGIN" -v e="$END" '
        $0 == b {skip=1} !skip {print} $0 == e {skip=0}' \
    | grep -v "ingestion\.run\|ingestion\.load_to_postgres\|scripts/dbt\.sh" || true)

printf '%s\n%s\n' "$cleaned" "$BLOCK" | grep -v '^$' | crontab -

echo "Установлено:"
crontab -l | sed -n "/$BEGIN/,/$END/p"
echo ""
echo "Логи:  $LOG_DIR/talap-YYYY-MM.log"
echo "Демон: $(systemctl is-active cron 2>/dev/null || echo '?')"
