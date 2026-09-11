# Развёртывание на сервере

Сервер: Ubuntu 24.04, пользователь `kiri`. Работаем **не от root**.

## Первый раз

```bash
ssh kiri@31.58.244.248

# Ключ для доступа к приватному репозиторию
ssh-keygen -t ed25519 -C "kiri@talap-server"
cat ~/.ssh/id_ed25519.pub
# → добавить в GitHub: Settings → SSH and GPG keys → New SSH key
ssh -T git@github.com     # должно ответить "Hi kiri3914!"

git clone git@github.com:kiri3914/IT-Talap.git ~/talap
```

Установка идёт в два шага: системная часть требует root, остальное — нет.

### Шаг 1 — от root, один раз

```bash
bash /home/kiri/talap/scripts/setup_server_root.sh
```

Ставит python3-venv, git, cron, переводит часовой пояс в Asia/Almaty,
включает cron в автозагрузку и добавляет `kiri` в группу sudo.

Если у `kiri` нет пароля (типичная ситуация, когда заходят через `su kiri`
из-под root) — задайте его тут же, иначе sudo работать не будет:

```bash
passwd kiri
```

### Шаг 2 — от kiri

```bash
cd ~/talap && bash scripts/setup_server.sh
```

Создаёт окружение, ставит зависимости и `.env` с правами 600. Sudo не требует.

## Заполнить credentials

```bash
nano ~/talap/.env
```

Обязательный минимум:

```
HH_CLIENT_ID=...
HH_CLIENT_SECRET=...
HH_USER_AGENT=Talap/0.1 (talap-project; kiri.bekos@gmail.com)

S3_ENDPOINT_URL=https://<account_id>.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_BUCKET=talap-raw
```

Желательно сразу — без них о сбое узнаете через месяц:

```
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
```

## Проверка

```bash
cd ~/talap && bash scripts/smoke.sh
```

Ожидаем в выводе `токен получен` и `собрано N вакансий`.
Без заполненного S3 упадёт на записи — это нормально, главное, что API ответил.

## Запуск по расписанию

```bash
bash scripts/install_cron.sh
```

Ставит запуск в 03:00 Asia/Almaty. Логи — `~/logs/talap-YYYY-MM.log`.

## Обновление кода

```bash
cd ~/talap && git pull && .venv/bin/pip install -q httpx pydantic boto3 python-dotenv
```

## Проверить, что сбор идёт

```bash
tail -50 ~/logs/talap-$(date +%Y-%m).log      # что было ночью
crontab -l                                     # задание на месте
systemctl status cron                          # демон жив
```

## Бэкфилл за пропущенную дату

```bash
cd ~/talap && .venv/bin/python -m ingestion.run --dt 2026-09-12
```

Партиция перезаписывается целиком — повторный запуск безопасен.

## Безопасность

- `.env` — права 600, в git не попадает (`.gitignore`)
- Токен hh кешируется в `~/.cache/talap/hh_token.json`, права 600
- Работаем от `kiri`, не от root
- Ключи R2 — только на сервере; для ротации перевыпустить токен в панели Cloudflare

## Известный риск

Сервер — единственная точка запуска. Если он недоступен, история за эти дни
не соберётся. Бакет вынесен наружу (R2), поэтому **уже собранные данные
переживут потерю сервера** — но новые в это время копиться не будут.
Отсюда важность алертов: пропуск запуска надо замечать в тот же день.

---

## Хранилище: MinIO на сервере

```bash
cd ~/talap

# пароль для MinIO
openssl rand -base64 24        # вставить в MINIO_ROOT_PASSWORD в .env
nano .env

docker compose up -d
docker compose ps                # STATUS должен стать healthy

.venv/bin/python scripts/init_bucket.py
```

Скрипт создаёт бакет, включает версионирование и проверяет запись/чтение.
Повторный запуск безопасен.

Если порт 9000 занят (`port is already allocated`) — посмотрите, кто его держит:

```bash
sudo ss -tlnp | grep 9000
docker ps -a | grep minio
```

Порты слушают только `127.0.0.1` — наружу MinIO не выставлен. Консоль смотреть через туннель с рабочей машины:

```bash
ssh -L 9001:localhost:9001 kiri@31.58.244.248
# затем http://localhost:9001 в браузере
```

В `.env` для MinIO:

```
S3_ENDPOINT_URL=http://127.0.0.1:9000
S3_ACCESS_KEY_ID=<MINIO_ROOT_USER>
S3_SECRET_ACCESS_KEY=<MINIO_ROOT_PASSWORD>
S3_BUCKET=talap-raw
S3_REGION=us-east-1
```

Версионирование бакета включается автоматически при создании — случайная перезапись партиции восстановима.

---

## Резервная копия raw — обязательна

**MinIO живёт на диске сервера.** Если диск умрёт, история исчезнет вся, и собрать
её заново нельзя: hh не отдаёт вчерашнюю выдачу. Это единственная необратимая
потеря в проекте — всё остальное пересчитывается из сырья.

Объём небольшой: единицы гигабайт в год в gzip. Бесплатных 10 ГБ на R2 хватит надолго.

```bash
sudo apt-get install -y rclone
rclone config
#   n) новый remote, имя: minio
#      тип: s3, provider: Minio, endpoint: http://127.0.0.1:9000
#      ключи — из .env
#   n) второй remote: backup (Cloudflare R2 или Backblaze B2)
```

В `.env`:

```
BACKUP_REMOTE=backup:talap-raw
```

Проверка и ежедневный запуск:

```bash
bash scripts/backup_raw.sh
crontab -e
# 30 4 * * * cd /home/kiri/talap && bash scripts/backup_raw.sh >> /home/kiri/logs/backup-$(date +\%Y-\%m).log 2>&1
```

04:30 — через полтора часа после сбора, чтобы копировалось уже готовое.

### Пока копии нет

Проект работает, но одна поломка диска стоит всей накопленной истории.
Допустимо первую неделю, дальше — риск растёт с каждым днём: чем больше собрано,
тем дороже потеря.
