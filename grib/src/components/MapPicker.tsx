import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  fetchElevation,
  GEO_PRIVACY_MODE,
  reverseRegion,
  searchPlaces,
} from "../lib/geo";
import type { LocationState, PlaceResult, RegionInfo } from "../lib/types";
import { IconLocate, IconPin, IconSearch, IconSpinner, IconX } from "./icons";

const PIN_HTML = `
<svg width="38" height="46" viewBox="0 0 38 46" xmlns="http://www.w3.org/2000/svg">
  <path d="M19 45C19 45 5 30.5 5 18.5 5 10 11.3 4 19 4s14 6 14 14.5C33 30.5 19 45 19 45z"
        fill="#0b110d" stroke="#d97b2f" stroke-width="2"/>
  <path d="M19 10.5c-5.1 0-8.8 3.2-8.8 6.2 0 1.3 1.1 2.1 2.4 2.1h12.8c1.3 0 2.4-.8 2.4-2.1 0-3-3.7-6.2-8.8-6.2z" fill="#d97b2f"/>
  <path d="M17.1 19.2l-.4 4.6c-.1 1 .7 1.9 1.7 1.9h1.2c1 0 1.8-.9 1.7-1.9l-.4-4.6z" fill="#ece5d3"/>
</svg>`;

const pinIcon = L.divIcon({
  className: "mushroom-pin",
  html: PIN_HTML,
  iconSize: [38, 46],
  iconAnchor: [19, 44],
});

interface Props {
  value: LocationState | null;
  onChange: (loc: LocationState) => void;
  notify: (text: string, tone?: "info" | "error" | "success") => void;
}

export function MapPicker({ value, onChange, notify }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const enrichTimer = useRef<number | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [touched, setTouched] = useState(false);

  const setPoint = useCallback(
    (lat: number, lng: number, flyTo = false) => {
      const map = mapRef.current;
      if (!map) return;
      setTouched(true);

      if (!markerRef.current) {
        markerRef.current = L.marker([lat, lng], {
          icon: pinIcon,
          draggable: true,
        }).addTo(map);
        markerRef.current.on("dragend", () => {
          const p = markerRef.current!.getLatLng();
          setPoint(p.lat, p.lng);
        });
      } else {
        markerRef.current.setLatLng([lat, lng]);
      }
      if (flyTo) {
        map.flyTo([lat, lng], Math.max(map.getZoom(), 13), { duration: 1.1 });
      }

      // координаты — сразу; регион и высота — фоном, чтобы не блокировать ввод
      onChange({
        latitude: lat,
        longitude: lng,
        elevation: valueRef.current?.elevation ?? null,
        region: valueRef.current?.region ?? null,
        regionPending: true,
      });

      if (enrichTimer.current) window.clearTimeout(enrichTimer.current);
      enrichTimer.current = window.setTimeout(async () => {
        const [region, elevation] = await Promise.all([
          reverseRegion(lat, lng).catch(() => null as RegionInfo | null),
          fetchElevation(lat, lng),
        ]);
        onChange({
          latitude: lat,
          longitude: lng,
          elevation,
          region,
          regionPending: false,
        });
      }, 450);
    },
    [onChange]
  );

  const setPointRef = useRef(setPoint);
  setPointRef.current = setPoint;

  useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current) return;

    const map = L.map(el, {
      center: [57.5, 61.0],
      zoom: 4,
      zoomControl: true,
      attributionControl: false,
    });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    map.on("click", (e: L.LeafletMouseEvent) => {
      setPointRef.current(e.latlng.lat, e.latlng.lng);
    });

    mapRef.current = map;
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);
    const t = window.setTimeout(() => map.invalidateSize(), 80);

    return () => {
      window.clearTimeout(t);
      ro.disconnect();
      if (enrichTimer.current) window.clearTimeout(enrichTimer.current);
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  async function handleSearch(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (q.length < 2) {
      notify("Введите название — минимум 2 символа.", "info");
      return;
    }
    setSearching(true);
    try {
      const found = await searchPlaces(q);
      setResults(found);
      if (found.length === 0) {
        notify(
          "Ничего не нашлось. Попробуйте другое название или поставьте точку вручную.",
          "info"
        );
      }
    } catch {
      notify("Геокодер сейчас недоступен. Поставьте точку прямо на карте.", "error");
    } finally {
      setSearching(false);
    }
  }

  function pickResult(r: PlaceResult) {
    setResults(null);
    setQuery(r.label.split(",")[0]);
    setPoint(r.lat, r.lon, true);
  }

  function handleLocate() {
    if (!("geolocation" in navigator)) {
      notify("Этот браузер не поддерживает геолокацию.", "error");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setPoint(pos.coords.latitude, pos.coords.longitude, true);
      },
      () => {
        setLocating(false);
        notify("Не удалось определить местоположение. Поставьте точку вручную.", "error");
      },
      { enableHighAccuracy: true, timeout: 9000 }
    );
  }

  return (
    <div>
      {/* поиск + геолокация */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <form onSubmit={handleSearch} className="relative flex-1">
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-dim">
            <IconSearch size={17} />
          </span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Населённый пункт, например: Новофомино"
            className="h-12 w-full rounded-md border border-line bg-card pl-10 pr-10 text-[15px] text-ink placeholder:text-ink-soft transition-colors focus:border-chanterelle-500/60"
            aria-label="Поиск населённого пункта"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setResults(null);
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-soft transition-colors hover:text-ink"
              aria-label="Очистить поиск"
            >
              <IconX size={16} />
            </button>
          )}

          {results && results.length > 0 && (
            <ul className="absolute inset-x-0 top-[52px] z-[1100] overflow-hidden rounded-md border border-pine-600 bg-pine-900 shadow-lift">
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => pickResult(r)}
                    className="flex w-full items-start gap-2.5 border-b border-pine-700/60 px-3.5 py-2.5 text-left transition-colors last:border-0 hover:bg-pine-700/70"
                  >
                    <span className="mt-0.5 shrink-0 text-rust-400">
                      <IconPin size={15} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-paper">
                        {r.label.split(",")[0]}
                      </span>
                      <span className="block truncate text-xs text-pine-200">
                        {r.label.split(",").slice(1).join(",").trim() || r.type}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </form>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleSearch as unknown as () => void}
            disabled={searching}
            className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-md bg-rust-500 px-5 text-sm font-semibold text-[#1c1207] transition-all hover:bg-rust-400 active:scale-[0.98] disabled:opacity-60 sm:flex-none"
          >
            {searching ? <IconSpinner size={16} /> : <IconSearch size={16} />}
            Найти
          </button>
          <button
            type="button"
            onClick={handleLocate}
            disabled={locating}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-md border border-line bg-card px-4 text-sm font-medium text-ink-soft transition-all hover:border-chanterelle-500/50 hover:text-ink active:scale-[0.98] disabled:opacity-60"
            title="Определить моё местоположение"
          >
            {locating ? <IconSpinner size={16} /> : <IconLocate size={16} />}
            <span className="hidden sm:inline">Я здесь</span>
          </button>
        </div>
      </div>

      {/* карта */}
      <div className="relative mt-3 overflow-hidden rounded-lg border border-moss-600/60 shadow-lift">
        <div ref={containerRef} className="z-0 h-[320px] w-full sm:h-[400px]" />
        {!touched && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 z-[1000] flex justify-center px-4">
            <span className="rounded-full border border-chanterelle-500/50 bg-pine-950/95 px-4 py-2 text-[12.5px] font-medium text-chanterelle-200 shadow-lift">
              Коснитесь карты — точка встанет сюда. Маркер можно перетаскивать.
            </span>
          </div>
        )}
      </div>

      {/* сводка по точке */}
      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
        <div className="rounded-md border border-pine-700/70 bg-pine-900 px-3.5 py-3">
          {value ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <span className="font-mono text-[13px] text-pine-50">
                {value.latitude.toFixed(6)}, {value.longitude.toFixed(6)}
              </span>
              <span className="text-[12.5px] text-pine-200">
                высота:{" "}
                <span className="text-pine-200">
                  {value.regionPending && value.elevation === null
                    ? "…"
                    : value.elevation !== null
                      ? `${value.elevation} м`
                      : "нет данных"}
                </span>
              </span>
            </div>
          ) : (
            <p className="text-[13px] text-dim">
              Точка пока не выбрана — найдите место поиском, геолокацией или
              кликом по карте.
            </p>
          )}
        </div>

        <div
          className={`flex items-center gap-2 rounded-md border px-3.5 py-3 text-[13px] transition-colors ${
            value?.region
              ? "border-pine-400/50 bg-pine-800/60 text-pine-200"
              : "border-pine-700/70 bg-pine-900 text-pine-200"
          }`}
        >
          {value?.regionPending ? (
            <>
              <span className="pulse-dot inline-block h-2 w-2 rounded-full bg-amberish" />
              определяем регион…
            </>
          ) : value?.region ? (
            <>
              <span className="rounded bg-pine-700/70 px-1.5 py-0.5 font-mono text-[11px] font-bold tracking-wide">
                {value.region.country}
              </span>
              <span className="font-medium">{value.region.name}</span>
            </>
          ) : (
            <>
              <IconPin size={15} />
              регион определится автоматически
            </>
          )}
        </div>
      </div>

      <p className="mt-2 font-mono text-[10.5px] uppercase tracking-wider text-ink-soft">
        GEO_PRIVACY_MODE: {GEO_PRIVACY_MODE} · регион не редактируется — только
        для аналитики
      </p>
    </div>
  );
}
