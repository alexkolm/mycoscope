import { useEffect, useMemo, useState } from "react";
import speciesData from "./data/species.json";
import { formatDateRu } from "./lib/observation";
import {
  buildExportDataset,
  buildPromptText,
  copyToClipboard,
  downloadWeatherDataset,
  fetchWeatherArchive,
  formatDateShortDMY,
  type WeatherResponse,
} from "./lib/weatherApi";
import type { SpeciesRef } from "./lib/types";
import { HeaderBubbles } from "./components/HeaderBubbles";
import { StaticPointMap } from "./components/StaticPointMap";
import { StopFactorsTable } from "./components/StopFactorsTable";
import {
  IconAlert,
  IconCalendar,
  IconCheck,
  IconCopy,
  IconDownload,
  IconMushroomLogo,
  IconSpinner,
} from "./components/icons";

const SPECIES_LIST = speciesData as SpeciesRef[];

interface QueryParams {
  lat: number;
  lon: number;
  date: string | null;
  elevation: number | null;
  regionName: string | null;
  regionCountry: string | null;
}

function readQueryParams(): QueryParams | null {
  const params = new URLSearchParams(window.location.search);
  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const elevationRaw = params.get("elevation");
  const elevation =
    elevationRaw !== null && elevationRaw !== "" && Number.isFinite(Number(elevationRaw))
      ? Number(elevationRaw)
      : null;

  return {
    lat,
    lon,
    date: params.get("date"),
    elevation,
    regionName: params.get("region_name"),
    regionCountry: params.get("region_country"),
  };
}

type Status = "loading" | "ready" | "error";

export default function WeatherArchive() {
  const query = useMemo(readQueryParams, []);
  const [status, setStatus] = useState<Status>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [data, setData] = useState<WeatherResponse | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(
    () => new Set([0]) // как в оригинале — по умолчанию отмечен первый вид (белый гриб)
  );
  const [copiedJson, setCopiedJson] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [speciesWarning, setSpeciesWarning] = useState(false);

  useEffect(() => {
    if (!query) {
      setStatus("error");
      setErrorMsg("В ссылке нет координат точки — откройте архив погоды из анкеты наблюдения.");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    fetchWeatherArchive({ lat: query.lat, lon: query.lon, days: 30, date: query.date ?? undefined })
      .then((resp) => {
        if (cancelled) return;
        setData(resp);
        setStatus("ready");
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setErrorMsg(err.message || "Не получилось загрузить погоду.");
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedSpecies = useMemo(
    () => SPECIES_LIST.filter((_, i) => selectedIds.has(i)),
    [selectedIds]
  );

  function toggleSpecies(i: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  async function handleCopyJson() {
    if (!data) return;
    const json = JSON.stringify(buildExportDataset(data), null, 2);
    const ok = await copyToClipboard(json);
    if (ok) {
      setCopiedJson(true);
      setTimeout(() => setCopiedJson(false), 3000);
    }
  }

  async function handleCopyPrompt() {
    if (!data) return;
    const text = buildPromptText(data, selectedSpecies);
    if (text === null) {
      setSpeciesWarning(true);
      return;
    }
    setSpeciesWarning(false);
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopiedPrompt(true);
      setTimeout(() => setCopiedPrompt(false), 3000);
    }
  }

  return (
    <div className="min-h-screen bg-paper text-ink">
      <header className="sticky top-0 z-40 overflow-hidden border-b border-line/90 bg-card/90 backdrop-blur-md">
        <HeaderBubbles />
        <div className="relative z-10 mx-auto flex min-h-16 w-full max-w-5xl items-center gap-3 px-4">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-pine-900 text-chanterelle-300 shadow-sm">
            <IconMushroomLogo size={22} />
          </span>
          <div className="min-w-0">
            <div className="font-display text-[17px] tracking-tight text-pine-950 sm:text-[19px]">
              Архив погоды
            </div>
            <div className="hidden font-mono text-[9.5px] tracking-[0.12em] text-ink-soft uppercase sm:block">
              Open-Meteo · оценка условий плодоношения
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 pb-24 pt-8">
        {query && (
          <div className="mb-6">
            {query.date && (
              <p className="mb-2 flex items-center gap-1.5 text-[13px] text-ink-soft">
                <IconCalendar size={14} />
                наблюдение от {formatDateRu(query.date)}
              </p>
            )}
            <StaticPointMap
              lat={query.lat}
              lon={query.lon}
              elevation={query.elevation}
              region={
                query.regionName || query.regionCountry
                  ? { name: query.regionName, country: query.regionCountry }
                  : null
              }
            />
          </div>
        )}

        {status === "loading" && (
          <div className="flex items-center gap-3 rounded-xl border border-line bg-card px-5 py-8 text-ink-soft">
            <IconSpinner size={18} className="animate-spin" />
            Загружаю архив погоды Open-Meteo…
          </div>
        )}

        {status === "error" && (
          <div className="flex items-start gap-3 rounded-xl border border-brick-500/40 bg-brick-500/10 px-5 py-4 text-[14px] text-pine-950">
            <IconAlert size={18} className="mt-0.5 shrink-0 text-brick-500" />
            <div>
              <p className="font-semibold">Не получилось загрузить погоду</p>
              <p className="mt-1 text-ink-soft">{errorMsg}</p>
            </div>
          </div>
        )}

        {status === "ready" && data && (
          <div className="flex flex-col gap-8">
            {/* Виды для анализа */}
            <section>
              <h2 className="mb-3 font-display text-[15px] text-pine-950">
                Виды для анализа
              </h2>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {SPECIES_LIST.map((sp, i) => {
                  const sci = Array.isArray(sp.scientific_name)
                    ? sp.scientific_name.join(", ")
                    : sp.scientific_name;
                  const checked = selectedIds.has(i);
                  return (
                    <label
                      key={i}
                      className={`flex cursor-pointer items-start gap-2.5 rounded-md border px-3.5 py-2.5 text-[13.5px] transition-colors ${
                        checked
                          ? "border-chanterelle-400/60 bg-chanterelle-500/10"
                          : "border-line bg-card hover:border-chanterelle-500/40"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSpecies(i)}
                        className="mt-0.5 accent-chanterelle-500"
                      />
                      <span>
                        <strong className="text-pine-950">{sp.common_name_ru}</strong>{" "}
                        <em className="text-ink-soft not-italic">({sci})</em>
                      </span>
                    </label>
                  );
                })}
              </div>
              {speciesWarning && (
                <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-brick-500">
                  <IconAlert size={14} />
                  Отметьте хотя бы один вид, чтобы собрать промт.
                </p>
              )}
            </section>

            {/* Кнопки действий */}
            <section className="flex flex-wrap gap-2.5">
              <button
                type="button"
                onClick={handleCopyPrompt}
                className="flex h-11 items-center gap-2 rounded-full border border-chanterelle-500/50 bg-chanterelle-500/12 px-4 text-[13.5px] font-semibold text-pine-950 transition-colors hover:bg-chanterelle-500/20 active:scale-[0.97]"
              >
                {copiedPrompt ? <IconCheck size={16} className="text-pine-700" /> : <IconCopy size={16} />}
                {copiedPrompt ? "Скопировано" : "Скопировать промт в буфер"}
              </button>
              <button
                type="button"
                onClick={handleCopyJson}
                className="flex h-11 items-center gap-2 rounded-full border border-line bg-card px-4 text-[13.5px] font-medium text-pine-950 transition-colors hover:border-chanterelle-500/50 active:scale-[0.97]"
              >
                {copiedJson ? <IconCheck size={16} className="text-pine-700" /> : <IconCopy size={16} />}
                {copiedJson ? "Скопировано" : "Скопировать JSON в буфер"}
              </button>
              <button
                type="button"
                onClick={() => downloadWeatherDataset(data)}
                className="flex h-11 items-center gap-2 rounded-full border border-line bg-card px-4 text-[13.5px] font-medium text-pine-950 transition-colors hover:border-chanterelle-500/50 active:scale-[0.97]"
              >
                <IconDownload size={16} />
                Скачать файл с JSON
              </button>
            </section>

            {/* Стоп-факторы */}
            <StopFactorsTable rows={data.rows} />

            {/* Таблица показателей */}
            <section>
              <h2 className="mb-3 font-display text-[15px] text-pine-950">
                Показатели погоды за {data.days} дней
              </h2>
              <div className="overflow-x-auto rounded-xl border border-line bg-card">
                <table className="border-collapse text-[12.5px]">
                  <thead>
                    <tr className="border-b border-line bg-moss-800/60 text-left text-ink-soft">
                      <th className="whitespace-nowrap px-2.5 py-2 text-[10px] font-medium leading-tight">
                        Дата
                      </th>
                      <th className="whitespace-nowrap px-2.5 py-2 text-[10px] font-medium leading-tight">
                        Δ дни
                      </th>
                      {data.params_order.map((key) => (
                        <th
                          key={key}
                          className="w-[62px] max-w-[62px] whitespace-normal break-words px-1.5 py-2 text-center text-[9.5px] font-medium leading-[1.15]"
                        >
                          {data.labels[key]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((row) => (
                      <tr key={row.date} className="border-b border-line/60 last:border-0">
                        <td className="whitespace-nowrap px-2.5 py-1.5 font-mono text-pine-950">
                          {formatDateShortDMY(row.date)}
                        </td>
                        <td className="whitespace-nowrap px-2.5 py-1.5 font-mono text-ink-soft">
                          {row.offset_days}
                        </td>
                        {data.params_order.map((key) => (
                          <td
                            key={key}
                            className="whitespace-nowrap px-1.5 py-1.5 text-center font-mono text-ink"
                          >
                            {row[key] === null || row[key] === undefined ? "—" : String(row[key])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[12px] text-ink-soft">
                Источник: Open-Meteo Forecast API (past_days, модель best-match) — данные высокого
                разрешения за прошедшие дни, не архив ERA5. Получено:{" "}
                {new Date(data.retrieved_at).toLocaleString("ru-RU")}.
              </p>
            </section>

            {/* Сырой JSON */}
            <section>
              <h2 className="mb-3 font-display text-[15px] text-pine-950">JSON-датасет</h2>
              <pre className="max-h-[420px] overflow-auto rounded-xl border border-line bg-pine-950 p-4 text-[11.5px] leading-relaxed text-chanterelle-200">
                {JSON.stringify(buildExportDataset(data), null, 2)}
              </pre>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
