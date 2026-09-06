import type { SpeciesRef } from "./types";

/** Один день погодного окна — форма ответа /api/weather на бэкенде grib-api. */
export interface WeatherRow {
  date: string;
  offset_days: number;
  [param: string]: number | string | null;
}

export interface WeatherRegion {
  country: string | null;
  name: string | null;
}

export interface WeatherResponse {
  lat: number;
  lon: number;
  elevation: number | null;
  region: WeatherRegion | null;
  observation_date: string;
  retrieved_at: string;
  days: number;
  labels: Record<string, string>;
  params_order: string[];
  rows: WeatherRow[];
}

export interface WeatherQuery {
  lat: number;
  lon: number;
  days?: number;
  /** Дата наблюдения (ISO). Если не задана — окно берётся до вчера. */
  date?: string;
}

const WEATHER_ENDPOINT = "/api/weather";
const FETCH_TIMEOUT_MS = 30_000;

/**
 * Запрашивает архив погоды у собственного бэкенда grib-api (тот, в свою
 * очередь, ходит в Open-Meteo с ретраями и кэшем — см. grib_api/weather.js).
 */
export async function fetchWeatherArchive(
  query: WeatherQuery
): Promise<WeatherResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(WEATHER_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(query),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}) as { error?: string });
      throw new Error(err.error || `Ошибка сервера: ${resp.status}`);
    }
    return (await resp.json()) as WeatherResponse;
  } finally {
    clearTimeout(timer);
  }
}

/** Датасет-экспорт: та же схема "dataset_type: mycoscope", что и в оригинале. */
export interface WeatherExportDataset {
  dataset_type: "mycoscope";
  version: "1.0";
  source: {
    provider: "Open-Meteo";
    archive: string;
    retrieved_at: string;
  };
  location: {
    latitude: number;
    longitude: number;
    elevation: number | null;
    region: WeatherRegion | null;
  };
  observation_date: string;
  weather_window: {
    start_delta_days: number;
    end_delta_days: number;
    days: Array<{ delta_days: number; date: string; [param: string]: unknown }>;
  };
}

/**
 * Порт buildExportDataset() из mycoscope/static/app.js.
 *
 * ВАЖНО про source.archive: это НЕ ERA5. Запрос идёт в
 * api.open-meteo.com/v1/forecast с параметром past_days — данные высокого
 * разрешения (1-5км) от прогностических моделей (best-match) за прошедшие
 * дни, "прошлый прогноз", а не реанализ. Подписывать это как ERA5 было бы
 * неточно.
 */
export function buildExportDataset(data: WeatherResponse): WeatherExportDataset {
  const { lat, lon, elevation, region, observation_date, retrieved_at, params_order, rows } =
    data;

  return {
    dataset_type: "mycoscope",
    version: "1.0",
    source: {
      provider: "Open-Meteo",
      archive: "Open-Meteo Forecast API (past_days, best-match model)",
      retrieved_at,
    },
    location: {
      latitude: lat,
      longitude: lon,
      elevation,
      region: region || null,
    },
    observation_date,
    weather_window: {
      start_delta_days: rows.length ? rows[0].offset_days : 0,
      end_delta_days: rows.length ? rows[rows.length - 1].offset_days : 0,
      days: rows.map((row) => {
        const entry: { delta_days: number; date: string; [k: string]: unknown } = {
          delta_days: row.offset_days,
          date: row.date,
        };
        for (const key of params_order) entry[key] = row[key];
        return entry;
      }),
    },
  };
}

function scientificNameText(sp: SpeciesRef): string {
  return Array.isArray(sp.scientific_name)
    ? sp.scientific_name.join(", ")
    : sp.scientific_name;
}

/**
 * "Белый гриб (Boletus edulis)" — один вид;
 * "Белый гриб (...), Лисичка обыкновенная (...) и Рыжик настоящий (...)" —
 * несколько, с союзом "и" перед последним. В отличие от оригинального
 * mycoscope (где были заготовлены формы родительного падежа множественного
 * числа под каждый вид), здесь используется именительный падеж — species.json
 * в grib не хранит такие формы, а выдумывать их автоматически рискованно
 * (не для всех видов множественное образуется по общему правилу).
 */
function buildSpeciesListText(selected: SpeciesRef[]): string {
  const items = selected.map((sp) => `${sp.common_name_ru} (${scientificNameText(sp)})`);
  if (items.length === 1) return items[0];
  return items.slice(0, -1).join(", ") + " и " + items[items.length - 1];
}

/** "2026-08-12" -> "12.08.2026" — полная дата для текста промта. */
function formatDateFullDMY(isoDateStr: string): string {
  const parts = isoDateStr.split("-");
  if (parts.length !== 3) return isoDateStr;
  const [yyyy, mm, dd] = parts;
  return `${dd}.${mm}.${yyyy}`;
}

/**
 * Порт buildPromptText() из mycoscope/static/app.js — тот же фиксированный
 * текст инструкции для нейросети, с подставленными видами и датой, плюс
 * JSON-датасет следом. Возвращает null, если ни один вид не выбран.
 *
 * Дата берётся из data.observation_date (последний день окна погоды —
 * либо реально выбранная дата наблюдения, либо вчера, если наблюдение
 * сегодня), а НЕ из текущего момента открытия страницы: иначе промт
 * говорил бы "на период <сегодня>+3 дня" даже когда анализируется
 * наблюдение недельной давности.
 */
export function buildPromptText(
  data: WeatherResponse,
  selectedSpecies: SpeciesRef[]
): string | null {
  if (selectedSpecies.length === 0) return null;

  const speciesText = buildSpeciesListText(selectedSpecies);
  const periodStr = formatDateFullDMY(data.observation_date);

  const instruction =
    `На основе архива погоды за ${data.days} дней (JSON ниже) оцени вероятность плодоношения следующих грибов:\n` +
    `${speciesText}\n` +
    `на период ${periodStr} +3 дня. Местообитание грибов считается подходящим, анализировать нужно только метеоусловия.\n` +
    `Используй свои знания о требованиях этих грибов к температуре воздуха и почвы, влажности почвы, осадкам и их динамике. Перечисли оптимальные для плодоношения условия, которые ты считаешь наиболее релевантными, и сравни их с фактическими данными из JSON.\n` +
    `Проанализируй динамику за последние 10–14 дней, особенно последние 5 дней. Обрати внимание на характер осадков (затяжные или ливневые), температурные колебания, влажность верхнего слоя почвы. Укажи, какие факторы способствуют, а какие препятствуют плодоношению.\n` +
    `Выдай итоговую вероятность в процентах и краткое обоснование. По возможности укажи, какие конкретно метеопараметры оказались решающими.`;

  const json = JSON.stringify(buildExportDataset(data), null, 2);
  return `${instruction}\n\n${json}`;
}

/** Имя файла для скачивания JSON — тот же паттерн, что в оригинале. */
export function weatherDatasetFilename(data: WeatherResponse): string {
  return `mycoscope_${data.lat.toFixed(4)}_${data.lon.toFixed(4)}_${data.observation_date}.json`;
}

export function downloadWeatherDataset(data: WeatherResponse): void {
  const json = JSON.stringify(buildExportDataset(data), null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = weatherDatasetFilename(data);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Копирует текст в буфер обмена с фолбэком на window.prompt (как в оригинале). */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    window.prompt("Скопируйте вручную:", text);
    return false;
  }
}

/** "2026-07-16" -> "16.07" — короткая дата для столбца таблицы. */
export function formatDateShortDMY(isoDateStr: string): string {
  const parts = isoDateStr.split("-");
  if (parts.length !== 3) return isoDateStr;
  const [, mm, dd] = parts;
  return `${dd}.${mm}`;
}
