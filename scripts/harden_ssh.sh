#!/usr/bin/env bash
# Закрыть SSH-вход по паролю. Запускать на сервере: sudo bash scripts/harden_ssh.sh
#
# Почему: 2026-10-26 сервер взломали подбором пароля пользователя по SSH,
# после чего начали подбирать пароль root. Вход только по ключам закрывает
# этот класс атак целиком — подбирать становится нечего.
#
# Скрипт сам себя страхует от запирания:
#   - не трогает конфиг, если у пользователя нет ни одного ключа
#   - проверяет синтаксис через sshd -t до применения
#   - делает reload, а не restart: открытые сессии не рвутся
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
    echo "нужен root: sudo bash $0" >&2; exit 1
fi

TARGET_USER="${SUDO_USER:-}"
if [ -z "$TARGET_USER" ] || [ "$TARGET_USER" = "root" ]; then
    echo "запускайте через sudo от обычного пользователя, не из-под root" >&2; exit 1
fi

KEYS="$(getent passwd "$TARGET_USER" | cut -d: -f6)/.ssh/authorized_keys"
n=$(grep -cE '^(ssh-|ecdsa-|sk-)' "$KEYS" 2>/dev/null || true)
if [ "${n:-0}" -eq 0 ]; then
    echo "СТОП: у $TARGET_USER нет ключей в $KEYS — после запрета паролей вы потеряете доступ" >&2
    exit 1
fi
echo "ключей у $TARGET_USER: $n — можно закрывать пароли"

# 00- в начале имени: в sshd_config.d побеждает ПЕРВОЕ значение, а облачные
# образы кладут 50-cloud-init.conf с PasswordAuthentication yes.
CONF=/etc/ssh/sshd_config.d/00-talap-hardening.conf
cat > "$CONF" <<'EOF'
# Создано scripts/harden_ssh.sh. Вход только по ключам.
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
PermitEmptyPasswords no
MaxAuthTries 3
LoginGraceTime 20
EOF
chmod 644 "$CONF"

if ! sshd -t; then
    echo "СТОП: sshd -t нашёл ошибку, откатываю" >&2
    rm -f "$CONF"; exit 1
fi

systemctl reload ssh 2>/dev/null || systemctl reload sshd
echo
echo "готово. Действующие значения:"
sshd -T 2>/dev/null | grep -E '^(passwordauthentication|kbdinteractiveauthentication|permitrootlogin|maxauthtries) '
echo
echo "ВАЖНО: не закрывайте это окно. В НОВОМ окне проверьте вход по ключу."
echo "Если не пускает — удалите $CONF и выполните systemctl reload ssh здесь."
