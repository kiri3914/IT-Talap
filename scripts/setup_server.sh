#!/usr/bin/env bash
# Развёртывание Talap на сервере. Запускать от пользователя kiri, не от root.
#   bash scripts/setup_server.sh
set -euo pipefail

REPO="git@github.com:kiri3914/IT-Talap.git"
APP_DIR="$HOME/talap"
LOG_DIR="$HOME/logs"

echo "==> Проверка: не root"
[ "$(id -u)" -ne 0 ] || { echo "ОШИБКА: запускать от kiri, не от root"; exit 1; }

echo "==> Системные пакеты"
sudo apt-get update -qq
sudo apt-get install -y -qq python3-venv python3-pip git tzdata

echo "==> Часовой пояс Asia/Almaty (cron по ТЗ — 03:00 UTC+6)"
sudo timedatectl set-timezone Asia/Almaty

echo "==> Репозиторий"
if [ -d "$APP_DIR/.git" ]; then
    git -C "$APP_DIR" pull --ff-only
else
    git clone "$REPO" "$APP_DIR"
fi
cd "$APP_DIR"

echo "==> Виртуальное окружение"
python3 -m venv .venv
.venv/bin/pip install -q --upgrade pip
.venv/bin/pip install -q httpx pydantic boto3 python-dotenv

echo "==> Каталог логов"
mkdir -p "$LOG_DIR"

echo "==> .env"
if [ ! -f .env ]; then
    cp .env.example .env
    chmod 600 .env
    echo ""
    echo "  !!! Заполните $APP_DIR/.env — без него сбор не запустится:"
    echo "      HH_CLIENT_ID, HH_CLIENT_SECRET, HH_USER_AGENT"
    echo "      S3_* (бакет R2)"
    echo ""
else
    chmod 600 .env
    echo "    .env уже есть, не трогаю"
fi

echo ""
echo "Готово. Дальше:"
echo "  1) nano $APP_DIR/.env        — заполнить credentials"
echo "  2) bash scripts/smoke.sh     — проверить, что API отвечает"
echo "  3) bash scripts/install_cron.sh  — поставить ежедневный запуск"
