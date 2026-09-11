#!/usr/bin/env bash
# Ежедневный сбор в 03:00 по местному времени (Asia/Almaty).
# Cron выключается только после трёх суток стабильной работы Airflow.
set -euo pipefail

APP_DIR="$HOME/talap"
LOG_DIR="$HOME/logs"
LINE="0 3 * * * cd $APP_DIR && $APP_DIR/.venv/bin/python -m ingestion.run >> $LOG_DIR/talap-\$(date +\\%Y-\\%m).log 2>&1"

mkdir -p "$LOG_DIR"

if crontab -l 2>/dev/null | grep -q "ingestion.run"; then
    echo "Задание уже стоит:"
    crontab -l | grep "ingestion.run"
    exit 0
fi

( crontab -l 2>/dev/null; echo "$LINE" ) | crontab -
echo "Поставлено:"
crontab -l | grep "ingestion.run"
echo ""
echo "Логи: $LOG_DIR/talap-YYYY-MM.log"
echo "Проверить, что cron жив: systemctl status cron"
