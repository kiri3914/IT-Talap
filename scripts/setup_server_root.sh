#!/usr/bin/env bash
# Системная часть. Запускать ОДИН РАЗ от root:
#   bash /home/kiri/talap/scripts/setup_server_root.sh
set -euo pipefail

APP_USER="${APP_USER:-kiri}"

[ "$(id -u)" -eq 0 ] || { echo "ОШИБКА: запускать от root"; exit 1; }

echo "==> Системные пакеты"
apt-get update -qq
apt-get install -y -qq python3-venv python3-pip git tzdata cron

echo "==> Часовой пояс Asia/Almaty (сбор в 03:00 UTC+6 по ТЗ)"
timedatectl set-timezone Asia/Almaty

echo "==> cron запущен и включён в автозагрузку"
systemctl enable --now cron

echo "==> Права sudo для $APP_USER (чтобы дальше не ходить под root)"
if id "$APP_USER" >/dev/null 2>&1; then
    usermod -aG sudo "$APP_USER"
    echo "    добавлен в группу sudo"
    echo "    ВАЖНО: задайте пароль, иначе sudo не сработает:  passwd $APP_USER"
else
    echo "    пользователь $APP_USER не найден — пропускаю"
fi

echo ""
echo "Готово. Дальше от $APP_USER:"
echo "  cd ~/talap && bash scripts/setup_server.sh"
