# grib / Mycoscope

Полевой журнал наблюдений за грибами (React/Vite фронтенд) + бэкенд на
Node.js (приём анкет, погодный архив Open-Meteo для оценки условий
плодоношения). Разворачивается на VPS напрямую через systemd, без Docker —
как и `mushroom-weather-lite`.

Прод: **grib.alexkolm.work**

## Структура репозитория

```
grib/            — фронтенд (React + TypeScript + Vite + Tailwind)
grib_api/        — бэкенд (Node.js/Express, systemd-сервис grib-api)
grib.alexkolm.work.nginx  — конфиг nginx (reverse proxy + отдача статики)
```

На сервере это разворачивается в:

```
/opt/grib          — собранный фронтенд (npm run build → dist/ отдаётся nginx)
/opt/grib-api       — бэкенд (порт 127.0.0.1:8030, systemd-юнит grib-api.service)
/opt/grib-api/data/observations/  — сохранённые анкеты (append-only JSON)
```

## Первичная настройка VPS (один раз)

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v && npm -v

sudo useradd --system --no-create-home --shell /usr/sbin/nologin grib
```

## Деплой / обновление

Проект хранится в папке `grib` на рабочем столе Windows. Обновление —
всегда: скопировать эту папку целиком на VPS во временную директорию,
установить зависимости, собрать, перезапустить сервис.

### 1. Копируем папку `grib` на VPS

```bash
rm -rf /tmp/grib
cp -r /drives/c/Users/Jane/Desktop/grib /tmp/
scp -r -J alexkolm@31.56.177.166:43921 -P 43921 /tmp/grib alexkolm@72.56.89.185:/tmp/
```

Проверка, что папка доехала:

```bash
ls -lah /tmp/grib
```

### 2. Раскладываем по местам

```bash
cp -a /tmp/grib/grib/. /opt/grib/
cp -a /tmp/grib/grib_api/. /opt/grib-api/
```

`cp -a ... /.` копирует содержимое папки (а не саму папку) поверх
существующего каталога — старые файлы в `/opt/grib` и `/opt/grib-api`
перезаписываются, но `/opt/grib-api/.env` и `/opt/grib-api/data/` **не
удаляются**, если их нет в исходной папке на рабочем столе (а их там и не
должно быть — секреты и данные наблюдений на сервере, не в репозитории).

### 3. Собираем фронтенд

```bash
cd /opt/grib
npm ci
npm run typecheck
npm run build
```

### 4. Обновляем бэкенд

```bash
cd /opt/grib-api
npm ci
sudo systemctl restart grib-api
```

### 5. Проверка

```bash
sudo ss -tulpn | grep 8030
curl http://127.0.0.1:8030/api/health

sudo systemctl reload nginx
sudo ss -tulpn | grep :80
ls -la /etc/nginx/sites-enabled/ | grep grib

curl -H "Host: grib.alexkolm.work" http://127.0.0.1/
curl -H "Host: grib.alexkolm.work" http://127.0.0.1/api/health
```

Все четыре `curl`/`ss` должны отвечать без ошибок: `{"status":"ok"}` от
health-эндпоинта, порт 8030 и 80 — в LISTEN, символическая ссылка
`grib.alexkolm.work` — в `sites-enabled`.

### 6. Данные наблюдений на месте

```bash
ls -la /opt/grib-api/data/observations/
```

## Восстановление .env после переустановки

`.env` не входит в репозиторий (см. `.gitignore`) и не трогается при
обновлении кода. Если разворачиваете `grib-api` с нуля на новом сервере —
создайте `/opt/grib-api/.env` вручную (порт, путь к данным, при
необходимости SMTP — см. комментарии в `grib_api/.env.example`, если он
есть в репозитории, либо восстановите из бэкапа).

## Основные эндпоинты бэкенда

| Метод | Путь | Назначение |
|---|---|---|
| `POST` | `/api/observations` | приём анкеты наблюдения, append-only запись в JSON |
| `POST` | `/api/weather` | архив погоды Open-Meteo для конкретной точки/даты |
| `GET` | `/api/health` | проверка живости сервиса |

## Nginx

Конфиг — `grib.alexkolm.work.nginx` в корне репозитория. TLS не
терминируется на сервере — сертификат и HTTPS обеспечивает Cloudflare
(режим Flexible), origin работает по обычному HTTP на 80 порту.
