import { useMemo } from "react";
import { computeStopFactors, type FactorStatus } from "../lib/stopFactors";
import type { WeatherRow } from "../lib/weatherApi";
import { formatDateShortDMY } from "../lib/weatherApi";

interface Props {
  /** Полный набор дней (нужен целиком — серии считаются по всему периоду). */
  rows: WeatherRow[];
}

/** Показываем не весь период, а последние 20 дней — как в оригинале mycoscope. */
const DISPLAY_WINDOW_DAYS = 20;

const STATUS_STYLES: Record<FactorStatus, string> = {
  ok: "bg-pine-200 text-pine-900 border-pine-300/70",
  risk: "bg-chanterelle-300 text-pine-950 border-chanterelle-400/70",
  stop: "bg-brick-500 text-white border-brick-600/70",
  none: "bg-moss-700/25 text-ink-soft border-line",
};

const STATUS_TEXT: Record<Exclude<FactorStatus, "none">, string> = {
  ok: "ОК",
  risk: "", // подставляется из cfg.riskText конкретного фактора
  stop: "СТОП",
};

export function StopFactorsTable({ rows }: Props) {
  const factors = useMemo(() => computeStopFactors(rows), [rows]);

  const displayIndexes = useMemo(
    () =>
      rows
        .map((row, i) => ({ row, i }))
        .filter(({ row }) => row.offset_days >= -DISPLAY_WINDOW_DAYS)
        .map(({ i }) => i),
    [rows]
  );

  if (rows.length === 0) return null;

  return (
    <section>
      <h2 className="mb-1 font-display text-[15px] text-pine-950">
        Стоп-факторы
      </h2>
      <p className="mb-3 text-[12px] text-ink-soft">
        Условия, при которых плодоношение маловероятно или уже начавшийся рост
        прерывается. Последние {Math.min(DISPLAY_WINDOW_DAYS + 1, rows.length)} дней.
      </p>
      <div className="overflow-x-auto rounded-xl border border-line bg-card p-2.5">
        <div className="flex flex-col gap-[3px]">
          {/* заголовок — Δ дни */}
          <div className="flex gap-[3px]">
            <div className="flex w-[132px] shrink-0 items-center bg-moss-800/60 px-2.5 text-[11px] font-semibold text-ink-soft">
              Δ дни
            </div>
            {displayIndexes.map((i) => (
              <div
                key={rows[i].date}
                className="flex h-7 w-[26px] shrink-0 items-center justify-center bg-moss-800/60 font-mono text-[10px] text-ink-soft"
              >
                {rows[i].offset_days}
              </div>
            ))}
          </div>

          {/* строки факторов */}
          {factors.map((factor) => (
            <div key={factor.label} className="flex gap-[3px]">
              <div className="flex w-[132px] shrink-0 items-center bg-moss-800/40 px-2.5 text-[11.5px] font-medium leading-tight text-pine-950">
                {factor.label}
              </div>
              {displayIndexes.map((i) => {
                const status = factor.statuses[i];
                const text =
                  status === "none"
                    ? ""
                    : status === "risk"
                      ? factor.riskText
                      : STATUS_TEXT[status];
                return (
                  <div
                    key={rows[i].date}
                    title={`Дата: ${formatDateShortDMY(rows[i].date)} (${rows[i].offset_days})\n${factor.tooltip(rows[i])}\nСтатус: ${text || "нет данных"}`}
                    className={`flex h-[54px] w-[26px] shrink-0 items-center justify-center border text-[9px] font-semibold tracking-wide ${STATUS_STYLES[status]}`}
                    style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
                  >
                    {text}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
