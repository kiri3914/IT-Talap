#!/usr/bin/env bash
# Копия raw-слоя из MinIO в удалённый бакет.
#
# MinIO лежит на диске сервера. Потеря диска = потеря всей истории,
# а собрать её заново нельзя: hh не отдаёт вчерашнюю выдачу.
# Этот скрипт — единственное, что отделяет проект от необратимой потери.
set -euo pipefail

cd "$(dirname "$0")/.."
. "$(dirname "$0")/load_env.sh"

: "${BACKUP_REMOTE:?BACKUP_REMOTE не задан в .env — копия не настроена}"
: "${S3_BUCKET:=talap-raw}"

if ! command -v rclone >/dev/null; then
    echo "rclone не установлен: sudo apt-get install -y rclone"
    exit 1
fi

echo "$(date '+%F %T') синхронизация minio:$S3_BUCKET -> $BACKUP_REMOTE"
rclone sync "minio:$S3_BUCKET" "$BACKUP_REMOTE" \
    --transfers 8 \
    --checkers 16 \
    --stats 30s \
    --stats-one-line

echo "$(date '+%F %T') готово"
