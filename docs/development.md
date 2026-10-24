# Разработка и развёртывание

## Локальный API

Нужны Go 1.26+ и PostgreSQL 17+. Создайте базу и пользователя, скопируйте `.env.example` в `.env`, задайте собственные `DATABASE_URL` и `POSTGRES_PASSWORD`.

Из корня:

```sh
set -a
. ./.env
set +a
cd apps/api
go mod download
go run ./cmd/migrate
go run ./cmd/server
```

API слушает `:8080`. Миграции читаются из `../../db/migrations`; при другой рабочей папке задайте `MIGRATIONS_DIR`. Тестовые данные создаются отдельно командой `go run ./cmd/seed`.

PostgreSQL можно запустить через Compose с публикацией порта только на loopback:

```sh
docker compose -f compose.yaml -f compose.dev.yaml up -d db
```

В `.env` для локальных Go-команд используется адрес `localhost`. Контейнеры Compose обращаются к базе по внутреннему имени `db`.

## Клиент

Нужны Node.js 24 и npm. В другом терминале:

```sh
cd apps/mobile
npm ci
cp .env.example .env.local
npm run web
```

Для веб-разработки `EXPO_PUBLIC_API_URL` указывает на `http://localhost:8080/api/v1`. Добавьте адрес страницы Metro в `CORS_ORIGINS` на API, если его порт отличается от стандартного. После изменения `EXPO_PUBLIC_*` перезапустите Expo: эти значения встраиваются в клиентскую сборку и не предназначены для секретов.

### Expo Go

Телефон и компьютер должны быть в одной сети. В `apps/mobile/.env.local` задайте адрес API, доступный с телефона:

```dotenv
EXPO_PUBLIC_API_URL=http://192.168.1.50:8080/api/v1
```

Замените IP на LAN-адрес компьютера. Если запущен полный Compose-стек, используйте порт Caddy `8090`. `PUBLIC_WEB_URL` на API также должен содержать доступный с телефона адрес для клиентских ссылок.

```sh
cd apps/mobile
npx expo start --lan
```

Откройте QR-код в Expo Go с поддержкой SDK 58. `localhost` на телефоне означает сам телефон; туннель Metro доставляет приложение, но не открывает Go API.

## Веб-экспорт

```sh
cd apps/mobile
EXPO_PUBLIC_API_URL=/api/v1 npm run export:web
```

Результат — `apps/mobile/dist`. Для вложенных маршрутов `/s/<token>` нужен SPA fallback на `index.html`; он включён в `infra/Caddyfile`. API и страница используют один origin.

Локальный Caddy можно запустить из корня без Docker:

```sh
SITE_ADDRESS=http://:8090 WEB_ROOT="$PWD/apps/mobile/dist" API_UPSTREAM=127.0.0.1:8080 caddy run --config infra/Caddyfile --adapter caddyfile
```

## HTTPS

Настройте DNS домена на сервер и откройте TCP 80/443. В `.env`:

```dotenv
SITE_ADDRESS=abonent.example.ru
WEB_HTTP_PORT=80
WEB_HTTPS_PORT=443
PUBLIC_WEB_URL=https://abonent.example.ru
CORS_ORIGINS=https://abonent.example.ru
```

Установите собственный пароль PostgreSQL и выполните `docker compose up --build -d`. Caddy получает TLS-сертификат для домена; тома `caddy_data` и `caddy_config` сохраняют его состояние. В основной конфигурации API и PostgreSQL доступны только внутри сети Compose. Для размещения не подключайте `compose.dev.yaml` и не создавайте демо-аккаунты.

## Данные и обслуживание

- `docker compose down` останавливает сервисы, сохраняя данные в томах. Удаление томов удаляет данные.
- Перед обновлением делайте резервную копию PostgreSQL и проверяйте восстановление.
- После изменения исходников выполните `docker compose up --build -d`.
- Повторный запуск миграций: `docker compose run --rm migrate`.
- Логи сервисов: `docker compose logs api migrate db web`.

Локальный стек Go/PostgreSQL/Caddy и веб-сценарии проверены. Полный запуск в Docker, публичный HTTPS и физические iOS/Android требуют отдельной приёмки. [Проверки](testing.md) описывают команды и ручной сценарий.
