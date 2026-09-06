import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { IconPin } from "./icons";
import { GEO_PRIVACY_MODE } from "../lib/geo";
import type { WeatherRegion } from "../lib/weatherApi";

const PIN_HTML = `
<svg width="34" height="41" viewBox="0 0 38 46" xmlns="http://www.w3.org/2000/svg">
  <path d="M19 45C19 45 5 30.5 5 18.5 5 10 11.3 4 19 4s14 6 14 14.5C33 30.5 19 45 19 45z"
        fill="#0b110d" stroke="#d97b2f" stroke-width="2"/>
  <path d="M19 10.5c-5.1 0-8.8 3.2-8.8 6.2 0 1.3 1.1 2.1 2.4 2.1h12.8c1.3 0 2.4-.8 2.4-2.1 0-3-3.7-6.2-8.8-6.2z" fill="#d97b2f"/>
  <path d="M17.1 19.2l-.4 4.6c-.1 1 .7 1.9 1.7 1.9h1.2c1 0 1.8-.9 1.7-1.9l-.4-4.6z" fill="#ece5d3"/>
</svg>`;

const pinIcon = L.divIcon({
  className: "mushroom-pin",
  html: PIN_HTML,
  iconSize: [34, 41],
  iconAnchor: [17, 40],
});

interface Props {
  lat: number;
  lon: number;
  elevation: number | null;
  region: WeatherRegion | null;
}

/**
 * Некликабельная карта точки для архива погоды — тот же тайл-слой и стиль
 * маркера, что в MapPicker на главной странице, но без поиска/геолокации
 * /перетаскивания: точка сюда уже приходит готовой из анкеты (раздел 01).
 * Средний масштаб (zoom 12) — чтобы были видны подписи соседних НП.
 */
export function StaticPointMap({ lat, lon, elevation, region }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current) return;

    const map = L.map(el, {
      center: [lat, lon],
      zoom: 12,
      zoomControl: true,
      dragging: true,
      scrollWheelZoom: false,
      doubleClickZoom: true,
      touchZoom: true,
      attributionControl: false,
    });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    L.marker([lat, lon], { icon: pinIcon, interactive: false }).addTo(map);

    mapRef.current = map;
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);
    const t = window.setTimeout(() => map.invalidateSize(), 80);

    return () => {
      window.clearTimeout(t);
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lon]);

  return (
    <div>
      <div className="relative overflow-hidden rounded-lg border border-moss-600/60 shadow-lift">
        <div ref={containerRef} className="z-0 h-[260px] w-full sm:h-[320px]" />
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
        <div className="rounded-md border border-pine-700/70 bg-pine-900 px-3.5 py-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <span className="font-mono text-[13px] text-pine-50">
              {lat.toFixed(6)}, {lon.toFixed(6)}
            </span>
            <span className="text-[12.5px] text-pine-200">
              высота: {elevation !== null ? `${elevation} м` : "нет данных"}
            </span>
          </div>
        </div>

        <div
          className={`flex items-center gap-2 rounded-md border px-3.5 py-3 text-[13px] transition-colors ${
            region
              ? "border-pine-400/50 bg-pine-800/60 text-pine-200"
              : "border-pine-700/70 bg-pine-900 text-pine-200"
          }`}
        >
          {region ? (
            <>
              <span className="rounded bg-pine-700/70 px-1.5 py-0.5 font-mono text-[11px] font-bold tracking-wide">
                {region.country}
              </span>
              <span className="font-medium">{region.name}</span>
            </>
          ) : (
            <>
              <IconPin size={15} />
              регион не определён
            </>
          )}
        </div>
      </div>

      <p className="mt-2 font-mono text-[10.5px] uppercase tracking-wider text-ink-soft">
        GEO_PRIVACY_MODE: {GEO_PRIVACY_MODE}
      </p>
    </div>
  );
}
