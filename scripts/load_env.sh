# Безопасное чтение .env в bash. Подключать так:  . scripts/load_env.sh
#
# Простое `set -a; . ./.env` ломается на незакавыченных значениях:
#   HH_USER_AGENT=Talap/1.0 (kiri.bekos@gmail.com)
# Скобки для bash — метасимволы, и файл не читается целиком.
# python-dotenv такое переваривает, поэтому расхождение вылезает
# только в shell-скриптах.
_talap_load_env() {
    local file="${1:-.env}" line key value
    [ -f "$file" ] || return 1
    while IFS= read -r line || [ -n "$line" ]; do
        case "$line" in ''|\#*) continue ;; esac
        case "$line" in *=*) ;; *) continue ;; esac
        key="${line%%=*}"
        value="${line#*=}"
        # Обрезаем пробелы вокруг имени
        key="$(printf '%s' "$key" | tr -d '[:space:]')"
        case "$key" in ''|*[!A-Za-z0-9_]*) continue ;; esac
        # Снимаем обрамляющие кавычки, если они есть
        case "$value" in
            \"*\") value="${value#\"}"; value="${value%\"}" ;;
            \'*\') value="${value#\'}"; value="${value%\'}" ;;
        esac
        export "$key=$value"
    done < "$file"
}
_talap_load_env "${ENV_FILE:-.env}"
