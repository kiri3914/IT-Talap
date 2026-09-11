#!/usr/bin/env bash
# Обзор сервера: порты, docker, диск, память, автозапуск.
# Только чтение, ничего не меняет. Секреты не печатает.
#   bash scripts/server_report.sh
#   bash scripts/server_report.sh > /tmp/report.txt   # чтобы прислать целиком

h() { printf '\n=== %s ===\n' "$1"; }

h "СИСТЕМА"
hostnamectl 2>/dev/null | grep -E 'Operating|Kernel|Architecture' || uname -a
echo "аптайм:$(uptime -p 2>/dev/null || uptime)"
echo "время:  $(date '+%F %T %Z')"

h "CPU И ПАМЯТЬ"
echo "ядер: $(nproc)"
free -h
echo ""
echo "нагрузка (1/5/15 мин): $(cut -d' ' -f1-3 /proc/loadavg)"

h "ДИСК"
df -h -x tmpfs -x devtmpfs
echo ""
echo "— крупнейшие каталоги в /home и /var:"
sudo du -xh -d 2 /home /var 2>/dev/null | sort -rh | head -12 \
  || du -xh -d 2 "$HOME" 2>/dev/null | sort -rh | head -8

h "ЗАНЯТЫЕ ПОРТЫ (слушающие)"
if sudo -n true 2>/dev/null; then
    sudo ss -tlnp
else
    ss -tln
    echo "(без sudo имена процессов не видны — запустите: sudo ss -tlnp)"
fi

h "ПОРТ 9000 — кто держит"
sudo ss -tlnp 2>/dev/null | grep -E ':900[0-9]' || ss -tln | grep -E ':900[0-9]' || echo "  свободен"

h "DOCKER — контейнеры"
if command -v docker >/dev/null; then
    docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}\t{{.Image}}'
    echo ""
    echo "— volumes:"
    docker volume ls
    echo ""
    echo "— место, занятое docker:"
    docker system df
else
    echo "  docker не установлen"
fi

h "СЕРВИСЫ В АВТОЗАПУСКЕ"
systemctl list-units --type=service --state=running --no-pager --no-legend 2>/dev/null \
  | awk '{print $1}' | head -25

h "CRON"
echo "— задания пользователя $(whoami):"
crontab -l 2>/dev/null || echo "  нет"
echo "— демон:"
systemctl is-active cron 2>/dev/null || echo "  не запущен"

h "ЧТО ЕЩЁ КРУТИТСЯ В ДОМАШНЕЙ ПАПКЕ"
ls -la "$HOME" 2>/dev/null | head -15

h "TALAP"
if [ -d "$HOME/talap" ]; then
    echo "коммит: $(git -C "$HOME/talap" log --oneline -1 2>/dev/null)"
    echo ".env:   $([ -f "$HOME/talap/.env" ] && echo "есть, права $(stat -c %a "$HOME/talap/.env")" || echo "нет")"
    echo "venv:   $([ -d "$HOME/talap/.venv" ] && echo есть || echo нет)"
    echo "логи:   $(ls -1 "$HOME/logs" 2>/dev/null | wc -l) файлов"
else
    echo "  не развёрнут"
fi

printf '\n=== КОНЕЦ ОТЧЁТА ===\n'
