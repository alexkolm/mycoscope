import type { WeatherRow } from "./weatherApi";

export type FactorStatus = "ok" | "risk" | "stop" | "none";

export interface FactorRowResult {
  label: string;
  /** Статус для каждого элемента входного массива rows (тот же порядок/длина). */
  statuses: FactorStatus[];
  /** Короткий текст в ячейке — свой на "risk"-статус у некоторых факторов (СУХО/МОКРО). */
  riskText: string;
  tooltip: (row: WeatherRow) => string;
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Статус дня зависит только от значения этого же дня — для факторов, где
 * даже один "плохой" день критичен сам по себе (например разовый заморозок).
 * Порт renderInstantStopRow() из mycoscope/static/app.js.
 */
function computeInstantFactor(
  rows: WeatherRow[],
  valueKey: string,
  isBad: (v: number) => boolean
): FactorStatus[] {
  return rows.map((row) => {
    const v = row[valueKey];
    if (!isNum(v)) return "none";
    return isBad(v) ? "stop" : "ok";
  });
}

/**
 * Статус зависит от ДЛИТЕЛЬНОСТИ подряд идущих "плохих" дней, а не
 * единичного дня (засуха, ветровое иссушение — критично накопление).
 * Порт renderStreakStopRow() — включая ключевой нюанс: серия считается по
 * ПОЛНОМУ массиву rows, а не по обрезанному окну отображения, иначе серия,
 * начавшаяся до видимого окна, на первых видимых днях получила бы
 * заниженный (жёлтый вместо красного) статус.
 */
function computeStreakFactor(
  rows: WeatherRow[],
  isBadDay: (row: WeatherRow) => boolean,
  yellowMinStreak: number,
  redMinStreak: number
): FactorStatus[] {
  const badMap = rows.map(isBadDay);
  const statusMap: FactorStatus[] = new Array(rows.length).fill("ok");

  let streakStart = -1;
  let streakLength = 0;

  for (let i = 0; i < badMap.length; i++) {
    if (badMap[i]) {
      if (streakLength === 0) streakStart = i;
      streakLength++;
    }
    if (!badMap[i] || i === badMap.length - 1) {
      if (streakLength > 0) {
        let status: FactorStatus = "ok";
        if (streakLength >= redMinStreak) status = "stop";
        else if (streakLength >= yellowMinStreak) status = "risk";
        for (let j = streakStart; j < streakStart + streakLength; j++) {
          statusMap[j] = status;
        }
      }
      streakStart = -1;
      streakLength = 0;
    }
  }

  return statusMap;
}

/**
 * 6 стоп-факторов из mycoscope — только этот подмножество (без
 * благоприятных факторов / ТВП-триггера, по просьбе не переносить остальное).
 * Пороги и обоснования — дословно как в оригинале.
 */
export function computeStopFactors(rows: WeatherRow[]): FactorRowResult[] {
  return [
    {
      // Порог 3°C, не 0°C: temperature_2m_min измеряется на высоте 2м, а
      // реальная температура у поверхности почвы/подстилки в ясную тихую
      // ночь (радиационное выхолаживание) обычно на 2-4°C ниже показаний
      // термометра — порог даёт запас именно под этот эффект.
      label: "Заморозок (<3°C)",
      statuses: computeInstantFactor(rows, "temperature_2m_min", (v) => v < 3.0),
      riskText: "СТОП",
      tooltip: (row) => `T мин: ${row.temperature_2m_min ?? "—"}°C`,
    },
    {
      // Устойчивый прогрев верхнего слоя почвы выше ~24°C подавляет
      // формирование завязей — мицелий смещается в состояние покоя вместо
      // плодоношения.
      label: "Перегрев (>24°C)",
      statuses: computeInstantFactor(
        rows,
        "soil_temperature_0_to_7cm_mean",
        (v) => v > 24.0
      ),
      riskText: "СТОП",
      tooltip: (row) => `T почвы 0-7см: ${row.soil_temperature_0_to_7cm_mean ?? "—"}°C`,
    },
    {
      label: "Засуха (>3д.)",
      statuses: computeStreakFactor(
        rows,
        (row) =>
          isNum(row.soil_moisture_7_to_28cm_mean) &&
          row.soil_moisture_7_to_28cm_mean < 0.15,
        1,
        4
      ),
      riskText: "СУХО",
      tooltip: (row) => `Вл. почвы (7-28см): ${row.soil_moisture_7_to_28cm_mean ?? "—"} м³/м³`,
    },
    {
      // Сильный ветер (>8 м/с) + низкая влажность воздуха сушит молодые
      // примордии сверху даже при достаточной влажности почвы. Одного дня
      // обычно недостаточно — порог мягче, чем у засухи.
      label: "Иссушение ветром",
      statuses: computeStreakFactor(
        rows,
        (row) =>
          isNum(row.wind_speed_10m_max) &&
          isNum(row.relative_humidity_2m_mean) &&
          row.wind_speed_10m_max > 8.0 &&
          row.relative_humidity_2m_mean < 50.0,
        1,
        2
      ),
      riskText: "СУХО",
      tooltip: (row) =>
        `Ветер: ${row.wind_speed_10m_max ?? "—"} м/с, влажность возд.: ${row.relative_humidity_2m_mean ?? "—"}%`,
    },
    {
      // Зеркальный партнёр засухи — тот же глубокий слой (7-28см, зона
      // основного мицелия), верхний предел вместо нижнего. НЕ триггерим по
      // сырым осадкам: дождь — вход в систему, а не состояние почвы.
      label: "Заболачивание (>3д.)",
      statuses: computeStreakFactor(
        rows,
        (row) =>
          isNum(row.soil_moisture_7_to_28cm_mean) &&
          row.soil_moisture_7_to_28cm_mean > 0.42,
        1,
        4
      ),
      riskText: "МОКРО",
      tooltip: (row) => `Вл. почвы (7-28см): ${row.soil_moisture_7_to_28cm_mean ?? "—"} м³/м³`,
    },
    {
      // Дополняет "Перегрев почвы" со стороны воздуха: даже если верхний
      // слой почвы ещё не перегрелся, воздух >30°C — тепловой стресс для
      // уже растущих плодовых тел. Мгновенный триггер, не накопительный.
      label: "Жара (>30°C)",
      statuses: computeInstantFactor(rows, "temperature_2m_max", (v) => v > 30.0),
      riskText: "СТОП",
      tooltip: (row) => `T возд. макс: ${row.temperature_2m_max ?? "—"}°C`,
    },
  ];
}
