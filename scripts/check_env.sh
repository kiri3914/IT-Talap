#!/usr/bin/env bash
# Проверяет, что в .env есть всё нужное и нет ссылок вида ${VAR}.
# Значения не печатает — только имена переменных.
set -uo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || { echo "нет .env — скопируйте: cp .env.example .env"; exit 1; }

missing=0
check() {
    local name="$1" required="${2:-yes}"
    local line value
    line=$(grep -E "^${name}=" .env | tail -1 || true)
    value="${line#*=}"
    if [ -z "$line" ]; then
        [ "$required" = yes ] && { echo "  ✗ $name — нет в .env"; missing=1; } \
                              || echo "  · $name — не задан (необязательно)"
    elif [ -z "$value" ]; then
        [ "$required" = yes ] && { echo "  ✗ $name — пустой"; missing=1; } \
                              || echo "  · $name — пустой (необязательно)"
    elif [[ "$value" == *'${'* ]]; then
        echo "  ✗ $name — содержит \${...}, подставьте значение буквально"; missing=1
    elif [[ "$value" == *"<"*">"* ]]; then
        echo "  ✗ $name — остался placeholder из примера"; missing=1
    else
        echo "  ✓ $name"
    fi
}

echo "MinIO:"
check MINIO_ROOT_USER
check MINIO_ROOT_PASSWORD
echo "Хранилище:"
check S3_ENDPOINT_URL
check S3_ACCESS_KEY_ID
check S3_SECRET_ACCESS_KEY
check S3_BUCKET
echo "hh:"
check HH_USER_AGENT
check HH_CLIENT_ID
check HH_CLIENT_SECRET
echo "Необязательное:"
check TELEGRAM_BOT_TOKEN no
check TELEGRAM_CHAT_ID no
check BACKUP_REMOTE no

# Пароль MinIO короче 8 символов — контейнер не стартует
pwd_len=$(grep -E '^MINIO_ROOT_PASSWORD=' .env | tail -1 | sed 's/^[^=]*=//' | wc -c)
if [ "$pwd_len" -gt 1 ] && [ "$pwd_len" -lt 9 ]; then
    echo ""
    echo "  ✗ MINIO_ROOT_PASSWORD короче 8 символов — MinIO не запустится"
    missing=1
fi

echo ""
if [ "$missing" -eq 0 ]; then
    echo "Всё на месте. Дальше: docker compose up -d && bash scripts/smoke.sh"
else
    echo "Заполните отмеченное: nano .env"
    exit 1
fi
