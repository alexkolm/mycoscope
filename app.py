"""
mushroom-weather-lite — минимальный прототип.

Один эндпоинт: принимает координаты точки, дёргает Open-Meteo
(forecast API с параметром past_days — покрывает и недавнюю историю,
и сегодня, без сложностей с отдельным archive API), отдаёт табличку
только нужных параметров.

Каждый запрос логируется в data/queries.log (координаты, IP, дата) —
это и есть тот самый "мне для отладки" пункт из ТЗ.
"""
from __future__ import annotations

import asyncio
import datetime as dt
import json
import logging
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mushroom_weather_lite")

DATA_DIR = Path("/data")
DATA_DIR.mkdir(parents=True, exist_ok=True)
QUERY_LOG = DATA_DIR / "queries.log"

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"

# Те же параметры, что нужны для оценки плодоношения грибов
DAILY_PARAMS = [
    "temperature_2m_max",
    "temperature_2m_min",
    "temperature_2m_mean",
    "precipitation_sum",
    "relative_humidity_2m_mean",
    "wind_speed_10m_max",
    "soil_moisture_0_to_7cm_mean",
    "soil_temperature_0_to_7cm_mean",
]

# Человеко-читаемые подписи для таблицы
PARAM_LABELS = {
    "temperature_2m_max": "T макс, °C",
    "temperature_2m_min": "T мин, °C",
    "temperature_2m_mean": "T средняя, °C",
    "precipitation_sum": "Осадки, мм",
    "relative_humidity_2m_mean": "Влажность возд., %",
    "wind_speed_10m_max": "Ветер макс, м/с",
    "soil_moisture_0_to_7cm_mean": "Влажность почвы, м³/м³",
    "soil_temperature_0_to_7cm_mean": "T почвы, °C",
}

app = FastAPI(title="Mushroom Weather Lite")

# Простой in-memory кэш: одинаковый запрос (координаты + период) в течение
# CACHE_TTL_SECONDS не бьёт повторно в Open-Meteo. Не переживает рестарт
# процесса — этого достаточно для теста среди друзей, БД для кэша избыточна.
_weather_cache: dict[tuple, tuple[float, dict]] = {}
CACHE_TTL_SECONDS = 30 * 60  # 30 минут


def _cache_key(lat: float, lon: float, days: int) -> tuple:
    # округляем координаты, чтобы запросы "почти в ту же точку" тоже кэшировались
    return (round(lat, 4), round(lon, 4), days)


# Явные таймауты по стадиям запроса вместо одного общего числа — понятнее,
# на чём именно спотыкается сеть, если что-то пойдёт не так.
OPEN_METEO_TIMEOUT = httpx.Timeout(connect=10.0, read=20.0, write=10.0, pool=5.0)
MAX_RETRIES = 3
RETRY_DELAYS = [1.0, 3.0]  # секунды между попытками (после 1-й и 2-й неудачи)


async def _fetch_from_open_meteo(params: dict) -> dict:
    """
    Запрос к Open-Meteo с повторными попытками. Открытый интернет и
    сторонний API иногда подвисают на секунды — вместо того чтобы сразу
    отдавать пользователю ошибку, тихо пробуем ещё пару раз.
    """
    last_exc: Exception | None = None

    async with httpx.AsyncClient(timeout=OPEN_METEO_TIMEOUT) as client:
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                resp = await client.get(FORECAST_URL, params=params)
                resp.raise_for_status()
                return resp.json()
            except httpx.HTTPStatusError as exc:
                # Ответ пришёл, но с кодом ошибки (4xx/5xx) — повторять
                # имеет смысл только для 5xx (проблема на стороне Open-Meteo),
                # 4xx означает ошибку в наших параметрах — повтор не поможет.
                if exc.response.status_code < 500:
                    raise HTTPException(
                        status_code=502,
                        detail=f"Open-Meteo отклонил запрос: {exc.response.status_code}",
                    ) from exc
                last_exc = exc
            except httpx.RequestError as exc:
                # Обрыв соединения, таймаут, DNS-сбой и т.п. — сетевая проблема,
                # имеет смысл повторить.
                last_exc = exc

            if attempt < MAX_RETRIES:
                delay = RETRY_DELAYS[attempt - 1]
                logger.warning(
                    "Open-Meteo попытка %s/%s не удалась (%s), повтор через %.0fс",
                    attempt, MAX_RETRIES, last_exc, delay,
                )
                await asyncio.sleep(delay)

    logger.error("Open-Meteo недоступен после %s попыток: %s", MAX_RETRIES, last_exc)
    raise HTTPException(
        status_code=502,
        detail=f"Open-Meteo не отвечает после {MAX_RETRIES} попыток: {last_exc}",
    )


class WeatherQuery(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lon: float = Field(..., ge=-180, le=180)
    days: int = Field(14, ge=3, le=60)  # сколько дней истории (по умолчанию 2 недели)


def _log_query(req: Request, q: WeatherQuery) -> None:
    entry = {
        "ts": dt.datetime.utcnow().isoformat(),
        "ip": req.client.host if req.client else None,
        "lat": q.lat,
        "lon": q.lon,
        "days": q.days,
    }
    with open(QUERY_LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    logger.info("Запрос погоды: %s", entry)


@app.post("/api/weather")
async def get_weather(query: WeatherQuery, request: Request):
    _log_query(request, query)

    cache_key = _cache_key(query.lat, query.lon, query.days)
    cached = _weather_cache.get(cache_key)
    now = dt.datetime.utcnow().timestamp()
    if cached and (now - cached[0]) < CACHE_TTL_SECONDS:
        logger.info("Ответ из кэша для %s", cache_key)
        return cached[1]

    params = {
        "latitude": query.lat,
        "longitude": query.lon,
        "daily": ",".join(DAILY_PARAMS),
        "past_days": query.days,
        "forecast_days": 1,
        "timezone": "auto",
    }

    raw = await _fetch_from_open_meteo(params)
    daily = raw.get("daily", {})
    dates = daily.get("time", [])

    today = dt.date.today().isoformat()
    rows = []
    for i, date_str in enumerate(dates):
        if date_str > today:
            continue  # прогнозные дни вперёд не показываем — нужна только история
        row = {"date": date_str}
        for key in DAILY_PARAMS:
            values = daily.get(key)
            row[key] = values[i] if values and i < len(values) else None
        rows.append(row)

    result = {
        "lat": query.lat,
        "lon": query.lon,
        "labels": PARAM_LABELS,
        "params_order": DAILY_PARAMS,
        "rows": rows,
    }
    _weather_cache[cache_key] = (now, result)
    return result


@app.get("/api/health")
def health():
    return {"status": "ok"}


# Раздаём статику (index.html, app.js, style.css) — сам фронт лежит в static/
app.mount("/", StaticFiles(directory="static", html=True), name="static")
