# MycoScope 🍄 (Грибосводка)

Лёгкий веб-сервис для грибников: выбираешь точку на карте (или вводишь координаты),
получаешь архив погоды за последние недели по этому месту из открытого источника
[Open-Meteo](https://open-meteo.com/), смотришь таблицу и графики (температура,
осадки, влажность почвы), и одним кликом формируешь готовый промт для анализа
вероятности плодоношения грибов в любой нейросети.

Живая версия: https://mushroom.alexkolm.work

## Возможности

* Выбор точки на карте (Leaflet + OpenStreetMap) или вручную по координатам
* Архив погоды за 10–60 дней: температура воздуха и почвы, осадки, влажность,
ветер — только параметры, потенциально влияющие на плодоношение грибов
* Три графика: температура (мин/макс), осадки, влажность почвы с цветовой
индикацией зон (засуха / норма / насыщение)
* Автоматическое определение региона точки (reverse geocoding через
OpenStreetMap/Nominatim с фолбэком на Open-Meteo Geocoding) — попадает в
текст промта для более точного анализа нейросетью
* Список из 7 видов грибов с иконками — выбираешь нужные, промт собирается
только под них
* Кнопка «Анализ (промт)» — готовый текст с данными и вопросом уходит в буфер
обмена, остаётся вставить в любую нейросеть (ChatGPT, Claude, Gemini и т.п.)
* Логирование запросов (координаты, дата) для отладки — без хранения полного
архива погоды

## Стек

* Backend: Python, FastAPI, httpx (запросы к Open-Meteo и Nominatim с ретраями)
* Frontend: чистый HTML/CSS/JS, Leaflet (карта), Chart.js (графики) — без сборки
* Прод: systemd + nginx (reverse proxy) + Cloudflare (DNS/TLS/кэш статики)

## Локальный запуск

```bash
python3 -m venv venv
./venv/bin/pip install -r requirements.txt
./venv/bin/uvicorn app:app --reload --port 8010
```

Открой `http://127.0.0.1:8010`.

Путь для логов запросов (`/data/queries.log`) сейчас захардкожен в `app.py`
как абсолютный `/data` — на Linux/VPS это ожидаемо, на Windows для локального
теста стоит либо создать `C:\\data`, либо на время поправить `DATA\_DIR` в
`app.py` на относительный путь.

## Структура

```
app.py              # backend: /api/weather, /api/health, раздача static/
static/
  index.html         # разметка + карта + описание проекта
  app.js              # логика: карта, запросы, таблица, графики, промт
  style.css            # стили
  icons/                # иконки видов грибов
```

## Деплой и обновление на проде

Прод развёрнут на VPS напрямую через `venv + systemd`, без Docker. Код лежит
в `/opt/mushroom-weather-lite`, сервис называется `mushroom-weather-lite.service`.
Прямой доступ по `root` через SSH закрыт — обновление идёт через
непривилегированного пользователя и `sudo`.

### Обновление статики (`static/`)

С Windows, через MobaXterm/scp — сначала во временную папку:

```powershell
scp -P 43921 -r "C:\\Users\\alexk\\Desktop\\mycoscope\\static" alexkolm@85.234.107.132:/tmp/
```

Затем на сервере:

```bash
sudo rm -rf /opt/mushroom-weather-lite/static
sudo cp -r /tmp/static /opt/mushroom-weather-lite/static
sudo chown -R root:root /opt/mushroom-weather-lite/static
rm -rf /tmp/static
```

Рестарт сервиса не нужен — статика отдаётся с диска при каждом запросе.
После обновления — жёсткий рефреш в браузере (`Ctrl+Shift+R`), чтобы сбросить
кэш; если менялось содержимое `app.js`/`style.css`, дополнительно стоит
поднять номер версии в `index.html` (`app.js?v=N`), чтобы не ждать
самостоятельного сброса кэша Cloudflare/браузера.

### Обновление backend (`app.py`)

```копируем файлы проекта в папку /tmp/ на VPS
```

```bash
sudo cp /tmp/app.py /opt/mushroom-weather-lite/app.py
sudo systemctl restart mushroom-weather-lite
rm /tmp/app.py
```

Контрольные точки после рестарта:

```bash
systemctl status mushroom-weather-lite   # active (running)
curl http://127.0.0.1:8010/api/health    # {"status":"ok"}
journalctl -u mushroom-weather-lite -n 20 --no-pager   # без traceback
```

## Nginx (reverse proxy)

Полный текущий конфиг (`/etc/nginx/sites-available/mushroom.alexkolm.work`):

```nginx
map $http\_cf\_connecting\_ip $client\_real\_ip {
    default $http\_cf\_connecting\_ip;
    ""      $remote\_addr;
}

limit\_req\_zone $client\_real\_ip zone=mushroom\_zone:10m rate=6r/m;

server {
    listen 80;
    server\_name mushroom.alexkolm.work;

    location /api/weather {
        limit\_req zone=mushroom\_zone burst=3 nodelay;
        proxy\_pass http://127.0.0.1:8010;
        proxy\_set\_header Host $host;
        proxy\_set\_header X-Real-IP $client\_real\_ip;
        proxy\_set\_header X-Forwarded-For $client\_real\_ip;
        proxy\_set\_header X-Forwarded-Proto $scheme;
        proxy\_read\_timeout 75s;
        proxy\_connect\_timeout 15s;
    }

    location / {
        proxy\_pass http://127.0.0.1:8010;
        proxy\_set\_header Host $host;
        proxy\_set\_header X-Real-IP $client\_real\_ip;
        proxy\_set\_header X-Forwarded-For $client\_real\_ip;
        proxy\_set\_header X-Forwarded-Proto $scheme;
    }
}
```

Пояснения:

* **`map $http\_cf\_connecting\_ip ...`** — вытаскивает реальный IP посетителя
из заголовка Cloudflare (без этого в логах был бы виден только IP edge-ноды
Cloudflare, не настоящего клиента).
* **`limit\_req\_zone` / `limit\_req`** — не больше 6 запросов в минуту к
`/api/weather` с одного реального IP (плюс всплеск на 3 запроса) — защита
от случайного или намеренного спама в Open-Meteo/Nominatim через открытый
публичный поддомен.
* **`proxy\_read\_timeout 75s`** — с запасом под ретраи backend'а к внешним API
(до 3 попыток с паузами внутри `app.py`).
* TLS не терминируется на этом сервере — сертификат и HTTPS обеспечивает
Cloudflare (режим Flexible), origin работает по обычному HTTP на 80 порту.

> На момент этой версии README в конфиге нет отдельного `location` с
> `Cache-Control` для `/icons/\*.png` — иконки видов грибов не кэшируются
> браузером долгосрочно, только на стороне Cloudflare edge. Обсуждается
> добавление такого блока для ускорения повторных визитов.

## Статус

Проект в стадии активного теста среди друзей. Идеи, баги, пожелания — welcome
через Issues.

