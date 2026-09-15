#!/usr/bin/env bash
# Копия сырья из MinIO во внешний бакет.
#
# Зачем: MinIO живёт на одном диске одного сервера. Версионирование внутри
# него — это undo, а не бэкап: умрёт диск — уйдёт и оригинал, и версии.
# Восстановить нельзя ничем: hh вчерашнюю выдачу не отдаёт.
#
# copy, а не sync. sync удалил бы в копии то, чего не стало в оригинале —
# то есть аккуратно повторил бы за нами любую случайную потерю. Копия
# только растёт; лишние объекты в ней безвреднее отсутствующих.
set -uo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$APP_DIR/scripts/load_env.sh"

if [ -z "${BACKUP_REMOTE:-}" ]; then
    echo "BACKUP_REMOTE не задан — копия наружу пропущена"
    exit 0
fi

if ! command -v rclone >/dev/null; then
    echo "rclone не установлен, а BACKUP_REMOTE задан" >&2
    exit 1
fi

# Сам rclone про наш MinIO знает из ~/.config/rclone/rclone.conf,
# см. docs/deploy.md — секреты в argv не кладём, их видно в ps.
echo "копирую ${BACKUP_SOURCE:-minio:$S3_BUCKET} -> $BACKUP_REMOTE"
rclone copy "${BACKUP_SOURCE:-minio:$S3_BUCKET}" "$BACKUP_REMOTE" \
    --transfers 8 \
    --checkers 16 \
    --stats 30s \
    --stats-one-line \
    --log-level INFO
rc=$?

if [ $rc -ne 0 ]; then
    echo "rclone вернул $rc" >&2
    exit $rc
fi

# Сверка размеров: «команда отработала» и «данные доехали» — разные вещи.
echo ""
echo "── сверка ──"
rclone size "${BACKUP_SOURCE:-minio:$S3_BUCKET}" 2>/dev/null | sed 's/^/оригинал: /'
rclone size "$BACKUP_REMOTE"                     2>/dev/null | sed 's/^/копия:    /'
