#!/usr/bin/env bash
# Пользовательская часть — БЕЗ sudo.
# Системные пакеты ставит scripts/setup_server_root.sh (один раз от root).
#   bash scripts/setup_server.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$HOME/logs"

cd "$APP_DIR"

echo "==> Проверка окружения"
[ "$(id -u)" -ne 0 ] || { echo "ОШИБКА: запускать не от root"; exit 1; }

if ! python3 -c "import venv" 2>/dev/null; then
    cat <<'MSG'
ОШИБКА: python3-venv не установлен.

Системные пакеты ставятся один раз от root:
    su -                  # или exit, если вы сюда зашли через su
    bash /home/kiri/talap/scripts/setup_server_root.sh
MSG
    exit 1
fi
echo "    python3 $(python3 -V 2>&1 | cut -d' ' -f2), venv доступен"

echo "==> Виртуальное окружение"
python3 -m venv .venv
.venv/bin/pip install -q --upgrade pip
.venv/bin/pip install -q httpx pydantic boto3 python-dotenv
echo "    зависимости установлены"

echo "==> Каталог логов"
mkdir -p "$LOG_DIR"

echo "==> .env"
if [ ! -f .env ]; then
    cp .env.example .env
    chmod 600 .env
    echo "    создан из .env.example (права 600)"
else
    chmod 600 .env
    echo "    уже есть, не трогаю"
fi

echo "==> Часовой пояс: $(cat /etc/timezone 2>/dev/null || date +%Z)"

echo ""
echo "Готово. Дальше:"
echo "  1) nano $APP_DIR/.env            — HH_CLIENT_ID, HH_CLIENT_SECRET, S3_*"
echo "  2) bash scripts/smoke.sh         — проверить, что API отвечает"
echo "  3) bash scripts/install_cron.sh  — ежедневный запуск"
