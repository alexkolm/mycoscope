"use strict";

/**
 * /api/weather — архив погоды Open-Meteo для раздела "Архив погоды".
 *
 * Порт логики из mycoscope/app.py (FastAPI + httpx) на чистый Node —
 * без сторонних HTTP-библиотек, используется нативный fetch (Node ≥18).
 * Сохранены: ретраи к Open-Meteo с явными таймаутами, in-memory кэш
 * погоды и региона, reverse-геокодинг через Nominatim.
 *
 * Отличие от оригинала: там окно всегда "today-30 .. today-1" (архив
 * привязан к моменту открытия страницы). Здесь окно может быть привязано
 * к конкретной дате наблюдения ("date" в body) — это нужно, чтобы можно
 * было посмотреть погоду перед фактическим выходом за грибами, даже если
 * анализ открывают спустя несколько дней после самого наблюдения.
 * Если переданная дата ещё не завершилась (равна "сегодня" по UTC) —
 * последним полным днём считается вчера, как и в оригинале (сутки же не
 * закончились — сравнивать с остальными днями нельзя).
 *
 * offset_days при этом отсчитывается от последнего дня окна (0), а не от
 * реального "сегодня" — например для days=30 диапазон offset: -29..0.
 */

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse";
const NOMINATIM_USER_AGENT =
  "GribMycoscope/1.0 (https://github.com/alexkolm/grib)";

const DEFAULT_DAYS = 30;
const MIN_DAYS = 5;
const MAX_DAYS = 60;

// Тот же полный набор параметров и подписей, что в mycoscope/app.py —
// порядок здесь же определяет порядок столбцов таблицы на странице.
const DAILY_PARAMS = [
  "temperature_2m_mean",
  "temperature_2m_max",
  "temperature_2m_min",
  "soil_temperature_0_to_7cm_mean",
  "soil_temperature_7_to_28cm_mean",
  "soil_moisture_0_to_7cm_mean",
  "soil_moisture_7_to_28cm_mean",
  "precipitation_sum",
  "precipitation_hours",
  "et0_fao_evapotranspiration",
  "relative_humidity_2m_mean",
  "wind_speed_10m_max",
  "dew_point_2m_mean",
];

const PARAM_LABELS = {
  temperature_2m_mean: "T возд. сред, °C",
  temperature_2m_max: "T возд. макс, °C",
  temperature_2m_min: "T возд. мин, °C",
  soil_temperature_0_to_7cm_mean: "T почвы 0-7см, °C",
  soil_temperature_7_to_28cm_mean: "T почвы 7-28см, °C",
  soil_moisture_0_to_7cm_mean: "Вл. почвы 0-7см, м³/м³",
  soil_moisture_7_to_28cm_mean: "Вл. почвы 7-28см, м³/м³",
  precipitation_sum: "Осадки, мм",
  precipitation_hours: "Осадки, ч",
  et0_fao_evapotranspiration: "Испарение ET₀, мм",
  relative_humidity_2m_mean: "Вл. возд., %",
  wind_speed_10m_max: "Ветер макс, м/с",
  dew_point_2m_mean: "Точка росы, °C",
};

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 минут — как в оригинале
const REGION_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 дней

const weatherCache = new Map();
const regionCache = new Map();

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function parseISODate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function addDaysUTC(date, days) {
  return new Date(date.getTime() + days * 86400000);
}

function diffDays(a, b) {
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}

async function fetchWithRetries(url) {
  const TIMEOUT_MS = 20_000;
  const DELAYS = [1000, 3000];
  let lastErr;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const resp = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (resp.ok) return await resp.json();
      if (resp.status < 500) {
        const text = await resp.text().catch(() => "");
        const err = new Error(
          `Open-Meteo отклонил запрос (${resp.status}): ${text.slice(0, 300)}`
        );
        err.status = 502;
        throw err;
      }
      lastErr = new Error(`Open-Meteo вернул ${resp.status}`);
    } catch (err) {
      clearTimeout(timer);
      if (err.status) throw err; // 4xx — не ретраим, как в оригинале
      lastErr = err;
    }
    if (attempt < 3) {
      console.warn(
        `[weather] Open-Meteo попытка ${attempt}/3 не удалась (${lastErr.message}), повтор через ${DELAYS[attempt - 1]}мс`
      );
      await new Promise((r) => setTimeout(r, DELAYS[attempt - 1]));
    }
  }

  const err = new Error(`Open-Meteo не отвечает после 3 попыток: ${lastErr?.message}`);
  err.status = 502;
  throw err;
}

async function resolveRegion(lat, lon) {
  const key = `${lat.toFixed(2)}:${lon.toFixed(2)}`;
  const cached = regionCache.get(key);
  if (cached && Date.now() - cached.ts < REGION_CACHE_TTL_MS) {
    return cached.region;
  }

  let region = null;
  try {
    const url = new URL(NOMINATIM_URL);
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lon));
    url.searchParams.set("format", "json");
    url.searchParams.set("zoom", "8");
    url.searchParams.set("addressdetails", "1");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const resp = await fetch(url, {
      headers: { "User-Agent": NOMINATIM_USER_AGENT },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (resp.ok) {
      const data = await resp.json();
      const addr = data.address || {};
      const regionName = addr.state || addr.region || addr.county || null;
      const countryCode = addr.country_code
        ? String(addr.country_code).toUpperCase()
        : null;
      if (regionName || countryCode) {
        region = { country: countryCode, name: regionName };
      }
    }
  } catch (err) {
    console.warn(
      `[weather] не удалось определить регион для (${lat}, ${lon}): ${err.message}`
    );
  }

  regionCache.set(key, { ts: Date.now(), region });
  return region;
}

async function handleWeather(req, res) {
  const body = req.body || {};
  const lat = Number(body.lat);
  const lon = Number(body.lon);

  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return res.status(400).json({ error: "bad lat" });
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    return res.status(400).json({ error: "bad lon" });
  }

  let days = Number.isFinite(Number(body.days))
    ? Math.round(Number(body.days))
    : DEFAULT_DAYS;
  days = Math.min(MAX_DAYS, Math.max(MIN_DAYS, days));

  const todayUTC = parseISODate(isoDate(new Date()));
  let endDay = addDaysUTC(todayUTC, -1); // по умолчанию — вчера, как в оригинале

  if (typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
    const parsed = parseISODate(body.date);
    if (parsed.getTime() < todayUTC.getTime()) {
      endDay = parsed; // прошедшая дата уже завершилась целиком — можно включать
    }
    // если дата == сегодня (или в будущем — такого фронт не пришлёт),
    // оставляем endDay = вчера, сутки ещё не закончились
  }

  const startDay = addDaysUTC(endDay, -(days - 1));
  const cacheKey = `${lat.toFixed(4)}:${lon.toFixed(4)}:${days}:${isoDate(endDay)}`;

  const cached = weatherCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return res.json(cached.data);
  }

  // Берём с запасом на 1 день больше, чтобы точно перекрыть окно, даже
  // если Open-Meteo вернёт на день меньше/больше на границах.
  const pastDaysNeeded = Math.max(1, diffDays(todayUTC, startDay) + 1);
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    daily: DAILY_PARAMS.join(","),
    past_days: String(pastDaysNeeded),
    forecast_days: "0",
    timezone: "auto",
  });

  let raw, region;
  try {
    [raw, region] = await Promise.all([
      fetchWithRetries(`${FORECAST_URL}?${params.toString()}`),
      resolveRegion(lat, lon),
    ]);
  } catch (err) {
    console.error("[weather] Open-Meteo недоступен:", err.message);
    return res.status(err.status || 502).json({ error: err.message });
  }

  const elevation = raw.elevation ?? null;
  const daily = raw.daily || {};
  const dates = daily.time || [];

  const allRows = [];
  for (let i = 0; i < dates.length; i++) {
    const rowDate = parseISODate(dates[i]);
    if (rowDate.getTime() < startDay.getTime() || rowDate.getTime() > endDay.getTime()) {
      continue; // вне запрошенного окна
    }
    const row = { date: dates[i], offset_days: diffDays(rowDate, endDay) };
    for (const key of DAILY_PARAMS) {
      const values = daily[key];
      row[key] = values && values[i] !== undefined ? values[i] : null;
    }
    allRows.push(row);
  }
  const rows = allRows.slice(-days);

  const result = {
    lat,
    lon,
    elevation,
    region,
    observation_date: isoDate(endDay),
    retrieved_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    days,
    labels: PARAM_LABELS,
    params_order: DAILY_PARAMS,
    rows,
  };

  weatherCache.set(cacheKey, { ts: Date.now(), data: result });
  res.json(result);
}

module.exports = { handleWeather, DAILY_PARAMS, PARAM_LABELS };
