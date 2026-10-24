# Контракт API

База `/api/v1`, JSON camelCase. ID — UUID-строки; время — RFC3339 с offset (ответ UTC), цена — целое число копеек. Ошибка `{ "error": { "code": "...", "message": "..." } }`. Все успешные ответы — прямые объекты, списки в `{items:[]}`. 201 создание, 200 чтение/изменение, 204 выход/отзыв. 400 validation_error, 401 unauthorized, 404 not_found (включая чужие ресурсы и отозванную ссылку), 409 conflict/insufficient_balance/payment_required, 500 internal_error.

## Сущности

User `{id,name,email}`. Client `{id,name,contact,phone,createdAt}`. Package `{id,clientId,title,totalLessons,priceKopecks,paymentStatus:"pending"|"paid",paidLessons,completedLessons,remainingLessons,paidAt:null|string,createdAt}`. Lesson `{id,packageId,scheduledAt,status:"scheduled"|"completed"|"cancelled",updatedAt}`. Detail `{package:Package,lessons:Lesson[]}`. ClientDetail `{client:Client,packages:Package[]}`. Auth `{token,expiresAt,user}`.

## Маршруты

- GET /health → `{status:"ok"}` (проверка БД).
- POST /auth/register `{name,email,password}` → 201 Auth. Имя 1..120, email валиден, пароль 10..128 символов.
- POST /auth/login `{email,password}` → Auth.
- GET /auth/me → User.
- POST /auth/logout → 204, отзывает Bearer-сессию.
- GET /clients?q=строка → `{items:Client[]}` только владельца.
- POST /clients `{name,contact?:string,phone?:string}` → 201 Client; контакт до 250.
- GET /clients/{id} → ClientDetail.
- PATCH /clients/{id} `{name,contact?:string,phone?:string}` → Client. Отсутствующие contact/phone сохраняют прежние значения, пустая строка очищает соответствующее поле.
- POST /clients/{id}/packages `{title,totalLessons,priceKopecks}` → 201 Package. Название 1..120, занятия 1..1000, копейки 0..1000000000.
- GET /packages/{id} → Detail.
- POST /packages/{id}/payment `{}` → Package, идемпотентно подтверждает полную оплату.
- POST /packages/{id}/lessons `{scheduledAt}` → 201 Lesson; планирование возможно до оплаты.
- PATCH /lessons/{id} `{action:"complete"|"cancel"|"reschedule"|"restore",scheduledAt?:string,confirmed?:boolean}` → Detail. complete: scheduled → completed, повтор completed идемпотентен, только после оплаты и при остатке >0. cancel/reschedule только scheduled (повтор cancelled → cancelled идемпотентен). restore: completed → scheduled, только confirmed:true; повтор scheduled + confirmed:true идемпотентен. reschedule сохраняет ID.
- POST /packages/{id}/share-link `{}` → 201 `{url,token}`. Ротация: предыдущая ссылка отзывается. URL `${PUBLIC_WEB_URL}/s/${token}`. Сырой токен возвращается только при создании, в БД только SHA256.
- DELETE /packages/{id}/share-link → 204, все ссылки пакета отозваны.
- GET /public/subscriptions/{token} → Detail (пакет и уроки; без clientId, контактов, userId, аудитных внутренних полей); имя клиента НЕ выдаётся. PublicPackage = Package без clientId. Токен не авторизует защищённые операции.

## Целостность и безопасность

- paidLessons = totalLessons если paid, иначе 0; completedLessons = count(completed); remainingLessons = paidLessons - completedLessons. Единственный источник — серверный SQL-расчёт.
- Перед любым переходом статуса — транзакция и SELECT пакета FOR UPDATE, затем чтение урока. Все writers используют один порядок блокировки; отрицательный остаток невозможен.
- payment и статус урока имеют audit: actor и время. Пакеты не редактируются.
- Пароль Argon2id (OWASP минимум 19 MiB, t=2, p=1, соль 16, ключ 32). Сессия random 32 bytes, хеш SHA256, 30 дней. Авторизация Bearer.
- На каждом ресурсе проверяется owner через JOIN. Статусы и тела строго валидируются, body <=1 MiB, БД context/таймаут.
- CORS только из CORS_ORIGINS (по умолчанию http://localhost:8081,http://localhost:8082,http://localhost:8090); OPTIONS; заголовки Authorization,Content-Type.
- Public: Cache-Control:no-store, Referrer-Policy:no-referrer. Нет логирования URL с токеном/паролей.
- WEB использует sessionStorage для сессии преподавателя, native SecureStore. Публичная страница не требует авторизации.
- После мутаций TanStack Query инвалидирует клиента/пакет/список; публичная страница refetch каждые 15 секунд и при фокусе.

## Окружение / команды

API `DATABASE_URL`, `HTTP_ADDR=:8080`, `PUBLIC_WEB_URL=http://localhost:8090`, `CORS_ORIGINS`.
Из apps/api: `go run ./cmd/server`, `go run ./cmd/migrate` (goose), `go run ./cmd/seed` (только явный запуск). Миграции из ../../db/migrations; MIGRATIONS_DIR переопределяет.
Demo: demo@abonent.local / DemoPass123!; 8 оплачено, 5 проведено, 3 осталось; seed выводит личную ссылку. Demo synthetic и только dev.
Docker: PostgreSQL 17+, API :8080, web Caddy :80/:443; dev доступ http://localhost:8090; same-origin /api/v1. Dockerfile файлы infra/api.Dockerfile и infra/web.Dockerfile. root build context.

## Телефон и интерфейс

- Отдельный необязательный phone сохраняется у Client, contact остаётся свободным дополнительным контактом. В ответе phone всегда строка, для старых клиентов пустая. Публичный ответ телефон не раскрывает.
- Формат российского номера: 10 национальных цифр с первым разрядом 3/4/8/9; ввод +7/8/10 цифр с допустимыми пробелами, скобками и дефисами. Сохраняется +7XXXXXXXXXX; буквы, неверная длина, иностранные коды и диапазоны Казахстана +7[67] отклоняются с 400 validation_error. Проверяется структура номера, а не его фактическая регистрация у оператора.
- Тема light/dark выбирается в общей шапке, начальное значение из системных настроек, выбор сохраняется отдельно от сессии (localStorage web / SecureStore native).
- Планирование/перенос используют календарь и выбор времени; wire-формат scheduledAt по-прежнему RFC3339 UTC, отображение в часовом поясе устройства.

## Обзор практики и продление

`GET /dashboard` требует Bearer и возвращает `{asOf, totals, renewals, upcomingLessons}` из одного PostgreSQL repeatable-read snapshot, только для владельца. Полная схема ответа — в [OpenAPI](openapi.yaml).

| Блок | Поля |
| --- | --- |
| `totals` | `clientCount`, `paidPackageCount`, `pendingPackageCount`, `confirmedPaymentsKopecks`, `pendingPaymentsKopecks`, `completedLessons`, `remainingLessons`, `remainingValueKopecks` |
| `renewals[]` | `clientId`, `clientName`, `packageId`, `packageTitle`, `totalLessons`, `priceKopecks`, `remainingLessons` |
| `upcomingLessons[]` | `id`, `packageId`, `clientId`, `clientName`, `packageTitle`, `scheduledAt` |

`asOf` — серверное время snapshot в RFC3339 UTC. Все суммы — целые копейки, пустые списки возвращаются как `[]`.

- Статистика за всё время: клиенты, оплаченные/ожидающие пакеты, суммы ручных подтверждений и ожидающих оплат, проведённые/оставшиеся занятия, стоимость ещё не проведённых оплаченных занятий. Последняя считается по каждому пакету как `priceKopecks - floor(priceKopecks * completedLessons / totalLessons)`; это не остаток банковского счёта и не прибыль.
- Очередь продления: клиенты с оплаченной историей и общим остатком не больше двух занятий. Условия шаблона берутся из последнего оплаченного пакета. Пока новый пакет ожидает оплаты, он не увеличивает оплаченный остаток.
- Расписание: первые 10 будущих `scheduled` за семь суток от серверного `asOf`, отсортированные по времени. Отменённые и проведённые исключены.
- После входа открывается `/dashboard`; меню «Обзор / Клиенты» доступно на закрытых страницах. Все мутации обновляют кеш обзора. Продление открывает редактируемую форму и создаёт обычный неоплаченный пакет только по действию пользователя.
- Публичная ссылка дополнительно показывает ближайшее будущее запланированное занятие. Контакты и имя клиента не раскрываются.
- `go run ./cmd/seed --showcase` явно создаёт отдельный синтетический аккаунт `showcase@abonent.local / DemoPass123!`: оплачено 20 000 ₽, ожидает 8 000 ₽, стоимость оставшихся занятий 8 000 ₽, два оплаченных пакета, один ожидающий. Повторный запуск сохраняет изменения и перевыпускает клиентскую ссылку; обычный demo и пользовательские записи не затрагиваются.
