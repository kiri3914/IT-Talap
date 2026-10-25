# Переезд на новый сервер

Когда нужен: старому серверу нельзя доверять (взлом), он умер, или просто
переезжаем. Всё, кроме сырья, восстанавливается из git и пересчитывается.
**Сырьё — единственное, что нельзя потерять.** Перед переездом убедитесь,
что у вас есть его свежая копия вне старого сервера.

## 0. Чего НЕ переносить со старого сервера

- `.env` — все секреты в нём считаются раскрытыми, заводятся заново
- `~/.ssh/id_*` — ключ сервера для GitHub тоже; новый ключ — новый
- любые бинарники, скрипты, crontab — только из git

## 1. Сервер: сначала закрыть, потом ставить

```bash
# с ноутбука — ваш ключ на новый сервер
ssh-copy-id <user>@<new-server>

# на сервере — вход только по ключам
git clone git@github.com:kiri3914/IT-Talap.git ~/talap
sudo bash ~/talap/scripts/harden_ssh.sh
```

Проверьте вход по ключу в **новом** окне, прежде чем закрывать текущее.

Про группу `docker`: членство в ней равно root без пароля. Если пользователь
в ней состоит — помните, что взлом этого пользователя = взлом всего сервера.

## 2. Новые секреты

Каждый из них — заново, не копией старого:

| что | где получить |
|---|---|
| hh `client_id` / `client_secret` | dev.hh.ru → приложение → сбросить секрет |
| токен бота алертов | @BotFather → `/revoke`, потом `/token` |
| пароли Postgres и MinIO | сгенерировать: `openssl rand -base64 24` |
| ключ сервера для GitHub | `ssh-keygen -t ed25519`, добавить как **deploy key только этого репозитория, read-only** — не как ключ аккаунта |
| `HEALTHCHECK_URL` | healthchecks.io |
| `BACKUP_REMOTE` | бакет R2 или B2, см. [deploy.md](deploy.md) |

Ключ сервера — deploy key, а не ключ аккаунта: ключ аккаунта даёт запись во
все ваши репозитории, и его кража со взломанного сервера — это доступ ко всему.

## 3. Поднять и залить

```bash
cd ~/talap
cp .env.example .env && chmod 600 .env && nano .env
docker compose up -d
python -m venv .venv && .venv/bin/pip install -e .
.venv/bin/python scripts/init_bucket.py

# сырьё с ноутбука
scp talap-raw-*.tar <user>@<new-server>:/tmp/
.venv/bin/python -m scripts.restore_raw_from_tar /tmp/talap-raw-*.tar --dry-run
.venv/bin/python -m scripts.restore_raw_from_tar /tmp/talap-raw-*.tar

# всё остальное пересчитывается из сырья
.venv/bin/python -m ingestion.load_to_postgres --full
bash scripts/dbt.sh build
bash scripts/install_cron.sh
```

## 4. Проверить

- `bash scripts/nightly.sh` руками — все шаги зелёные
- healthchecks.io показывает пинг
- через сутки: пришёл ли пинг сам, в 03:00
