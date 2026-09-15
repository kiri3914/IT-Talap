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

## Бэкфилл: чего можно и чего нельзя

**Вакансии за прошлую дату собрать НЕЛЬЗЯ.** hh отдаёт только текущую выдачу.
Запуск с `--dt` за вчера запишет сегодняшний снимок под вчерашним числом
и затрёт историю. С 2026-09-12 такой запуск отклоняется, обойти —
`--force-past`, но это осознанная порча данных.

Пропущенный день пропущен навсегда. Это и есть причина, по которой
алерт на пропуск запуска важнее большинства фич.

**Курсы валют за прошлые даты — можно:** нацбанки отдают историю.

```bash
.venv/bin/python -m ingestion.backfill_rates --from 2026-09-01 --to 2026-09-11
```

**Перезапуск за сегодня безопасен:** партиция перезаписывается целиком.

```bash
.venv/bin/python -m ingestion.run
```

## Восстановление затёртой партиции

Версионирование бакета включено, старые версии объектов сохраняются.

```bash
.venv/bin/python scripts/restore_partition.py \
  --prefix raw/hh/country=kz/dt=2026-09-11/ --list

.venv/bin/python scripts/restore_partition.py \
  --prefix raw/hh/country=kz/dt=2026-09-11/ --before 2026-09-12T00:00:00
```

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

### 1. Бакет наружу

Завести руками (аккаунт и ключи — ваши, я их не создаю):

- **Cloudflare R2** — 10 ГБ бесплатно, egress бесплатный. Account ID виден в
  адресе дашборда, ключи: R2 → Manage API Tokens.
- либо **Backblaze B2** — 10 ГБ бесплатно, ключи: Application Keys.

Бакет назвать, например, `talap-raw-backup`. Версионирование там включать не надо:
копия и так только дополняется.

### 2. rclone на сервере

```bash
sudo apt-get install -y rclone
rclone config
#   n) remote с именем  minio
#      type: s3, provider: Minio
#      endpoint: http://127.0.0.1:9010      <- наш порт, не 9000
#      access_key_id / secret_access_key — из .env
#
#   n) remote с именем  r2
#      type: s3, provider: Cloudflare
#      endpoint: https://<account_id>.r2.cloudflarestorage.com
#      region: auto
```

Секреты живут в `~/.config/rclone/rclone.conf` — не в `.env` и не в argv:
аргументы команд видны всем через `ps`.

```bash
chmod 600 ~/.config/rclone/rclone.conf
```

### 3. В `.env`

```
BACKUP_REMOTE=r2:talap-raw-backup
```

### 4. Проверка

```bash
bash scripts/backup_raw.sh
```

Первый прогон копирует всё накопленное, дальше — только новые объекты.
В конце скрипт печатает размеры оригинала и копии: «команда отработала»
и «данные доехали» — разные вещи, поэтому сверяем.

Отдельная запись в cron не нужна: копия идёт последним шагом `nightly.sh`,
после витрин. Пустой `BACKUP_REMOTE` шаг просто пропускает, прогон не падает.

### Пока копии нет

Проект работает, но одна поломка диска стоит всей накопленной истории.
Допустимо первую неделю, дальше — риск растёт с каждым днём: чем больше собрано,
тем дороже потеря.

---

## Порты MinIO конфликтуют с другим проектом

На сервере 9000/9001 занимает MinIO другого проекта (`kiri-minio`).
Поэтому Talap поднимается на 9010/9011 — это задаётся в `.env`:

```
MINIO_PORT=9010
MINIO_CONSOLE_PORT=9011
S3_ENDPOINT_URL=http://127.0.0.1:9010
```

Внутри контейнера порты всегда 9000/9001 — переменные меняют только сторону хоста.

Консоль смотреть через туннель:

```bash
ssh -L 9011:localhost:9011 kiri@31.58.244.248
# http://localhost:9011
```

### Почему не переиспользуем существующий kiri-minio

Технически можно было бы завести в нём отдельный бакет. Но тогда raw-слой Talap
разделил бы судьбу чужого стека: пересоздание того проекта, чистка volume или
смена ключей ударят по нашей истории, которую нельзя собрать заново.
Отдельный контейнер стоит ничего, а связанность убирает.


---

## PostgreSQL и загрузка сырья (Фаза 2)

Порт 5442, а не 5432: на сервере 5432 занят постгресами других проектов.

```bash
cd ~/talap && git pull

# пароль для базы
openssl rand -base64 24
nano .env          # PG_PASSWORD=...

.venv/bin/pip install -e .          # добавился psycopg
docker compose up -d postgres
docker compose ps                   # ждём healthy

.venv/bin/python -m ingestion.load_to_postgres
```

Загружает только те даты, которых ещё нет. `--full` перезаливает всё,
`--dt 2026-09-12` — конкретную дату. Повторный запуск безопасен:
идемпотентность через `ON CONFLICT DO UPDATE`.

Проверить:

```bash
docker exec -it talap-postgres psql -U talap -d talap -c "
  select dt, country, kind, count(*)
  from raw_landing.hh_vacancies group by 1,2,3 order by 1,2,3;"
```

### Подключиться к базе с ноутбука

```bash
ssh -L 5442:localhost:5442 kiri@31.58.244.248
# dbeaver / psql на 127.0.0.1:5442
```

### dbt

```bash
.venv/bin/pip install dbt-core dbt-postgres
mkdir -p ~/.dbt && cp dbt/profiles.yml.example ~/.dbt/profiles.yml
cd dbt && dbt deps && dbt run --select staging && dbt test --select staging
```

---

## Что ещё не поставлено на расписание

**Telegram** — код готов (`python -m ingestion.run_telegram`), но на cron
не ставится, пока не прочитаны условия Telegram API. Это блокер
из `docs/sources/telegram.md`.

**Загрузка в Postgres** — имеет смысл ставить после dbt-моделей,
пока запускается руками.
