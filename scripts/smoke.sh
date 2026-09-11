#!/usr/bin/env bash
# Быстрая проверка: получается ли токен и отвечает ли /vacancies.
# Бакет не трогает — только списки, одна страна.
set -euo pipefail
cd "$(dirname "$0")/.."
.venv/bin/python -m ingestion.run --country kz --skip-details --verbose
