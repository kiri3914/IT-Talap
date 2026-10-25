#!/usr/bin/env bash
# Обновить данные приложения: выгрузить на сервере и забрать в web/public/data.
#
#     TALAP_SERVER=user@host bash scripts/sync_app_data.sh
#
# Адрес сервера не хранится в репозитории: он публичный, а адрес и логин
# в открытом доступе — готовая цель для подбора пароля (так и случилось
# 2026-10-26). Можно положить TALAP_SERVER в локальный .env.
#
# Выгрузка содержит данные по отдельным вакансиям — каталог в .gitignore,
# коммитить и публиковать нельзя (docs/sources/hh.md §5).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [ -z "${TALAP_SERVER:-}" ] && [ -f .env ]; then
    TALAP_SERVER=$(grep -E '^TALAP_SERVER=' .env | cut -d= -f2- || true)
fi
: "${TALAP_SERVER:?укажите TALAP_SERVER=user@host}"

REMOTE_DIR=talap
TMP=/tmp/talap_app_$$
OUT="$ROOT/web/public/data"
mkdir -p "$OUT"

echo "→ код выгрузки на сервер"
# git pull на сервере не работает (ключ отозван), поэтому копируем нужные файлы
scp -q enrichment/*.py "$TALAP_SERVER:$REMOTE_DIR/enrichment/"
scp -q scripts/export_app_data.py scripts/export_site_data.py "$TALAP_SERVER:$REMOTE_DIR/scripts/"

echo "→ выгрузка"
ssh -o BatchMode=yes "$TALAP_SERVER" "cd $REMOTE_DIR && .venv/bin/python -m scripts.export_app_data --out $TMP \
    && .venv/bin/python -m scripts.export_site_data --out $TMP/overview.json"

echo "→ забираю"
scp -q "$TALAP_SERVER:$TMP/*.json" "$OUT/"
ssh -o BatchMode=yes "$TALAP_SERVER" "rm -rf $TMP"
cp "$OUT/overview.json" "$ROOT/site/data.json"

git check-ignore -q "$OUT/vacancies.json" || { echo "СТОП: $OUT не в .gitignore" >&2; exit 1; }
ls -lh "$OUT"
