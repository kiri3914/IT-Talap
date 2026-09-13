#!/usr/bin/env bash
# Запуск dbt с подхватом .env.
#
#   bash scripts/dbt.sh setup        один раз: установка и профиль
#   bash scripts/dbt.sh build        seed + run + test
#   bash scripts/dbt.sh run --select staging
#   bash scripts/dbt.sh docs         сгенерировать и поднять документацию
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VENV="$APP_DIR/.venv"
cd "$APP_DIR"

[ -f .env ] || { echo "нет .env — cp .env.example .env"; exit 1; }
set -a; . ./.env; set +a
: "${PG_PASSWORD:?PG_PASSWORD не задан в .env}"

case "${1:-build}" in
  setup)
    echo "==> Установка dbt"
    "$VENV/bin/pip" install -q "dbt-core>=1.8" "dbt-postgres>=1.8"
    echo "==> Профиль"
    mkdir -p "$HOME/.dbt"
    if [ -f "$HOME/.dbt/profiles.yml" ] && grep -q "^talap:" "$HOME/.dbt/profiles.yml"; then
        echo "    профиль talap уже есть, не трогаю"
    else
        cat dbt/profiles.yml.example >> "$HOME/.dbt/profiles.yml"
        echo "    добавлен в ~/.dbt/profiles.yml"
    fi
    echo "==> Пакеты dbt"
    cd dbt && "$VENV/bin/dbt" deps
    echo ""
    echo "Готово. Дальше: bash scripts/dbt.sh build"
    ;;

  build)
    cd dbt
    echo "==> Справочники (профессии, навыки)"
    "$VENV/bin/dbt" seed
    echo "==> Модели"
    "$VENV/bin/dbt" run
    echo "==> Тесты качества"
    "$VENV/bin/dbt" test
    ;;

  docs)
    cd dbt
    "$VENV/bin/dbt" docs generate
    echo "Документация и lineage: http://localhost:8081"
    echo "С ноутбука: ssh -L 8081:localhost:8081 kiri@31.58.244.248"
    "$VENV/bin/dbt" docs serve --port 8081
    ;;

  *)
    cd dbt && exec "$VENV/bin/dbt" "$@"
    ;;
esac
