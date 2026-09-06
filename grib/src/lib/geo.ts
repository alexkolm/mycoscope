import type { PlaceResult, RegionInfo } from "./types";

/**
 * Защита грибных мест.
 *
 * MVP: GEO_PRIVACY_MODE = "exact" — в журнал попадают реальные координаты.
 * Для перехода в режим обфускации достаточно поменять константу на
 * "obfuscated": интерфейс и JSON Schema не изменятся, а координата в
 * сохраняемом JSON будет случайно смещена (направление 0–360°,
 * расстояние 0,8–2,0 км). Исходная точка в публичный слой не попадает.
 */
export const GEO_PRIVACY_MODE: "exact" | "obfuscated" = "exact";

const EARTH_RADIUS_KM = 6371;

/** Случайное смещение точки: направление 0–360°, дистанция ~0,8–2,0 км. */
export function obfuscateCoordinates(
  latitude: number,
  longitude: number
): { latitude: number; longitude: number } {
  const angle = Math.random() * Math.PI * 2; // 0–360°
  const distanceKm = 0.8 + Math.random() * 1.2; // 0,8–2,0 км
  const dLat =
    ((distanceKm / EARTH_RADIUS_KM) * (180 / Math.PI)) * Math.sin(angle);
  const dLon =
    ((distanceKm / (EARTH_RADIUS_KM * Math.cos((latitude * Math.PI) / 180))) *
      (180 / Math.PI)) *
    Math.cos(angle);
  return { latitude: latitude + dLat, longitude: longitude + dLon };
}

/** Применяет текущий режим приватности к координатам, уходящим в JSON. */
export function processCoordinatesForStorage(
  latitude: number,
  longitude: number
): { latitude: number; longitude: number } {
  if (GEO_PRIVACY_MODE === "obfuscated") {
    return obfuscateCoordinates(latitude, longitude);
  }
  return { latitude, longitude };
}

const NOMINATIM = "https://nominatim.openstreetmap.org";

/** Геокодирование населённого пункта (Nominatim, язык ответа — русский). */
export async function searchPlaces(query: string): Promise<PlaceResult[]> {
  const url =
    `${NOMINATIM}/search?format=jsonv2&limit=6&addressdetails=1` +
    `&accept-language=ru&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`geocoder: ${res.status}`);
  const data = (await res.json()) as Array<{
    place_id?: number;
    display_name?: string;
    lat: string;
    lon: string;
    addresstype?: string;
    type?: string;
  }>;
  return data.map((d, i) => ({
    id: String(d.place_id ?? `${d.lat}-${d.lon}-${i}`),
    label: d.display_name ?? `${d.lat}, ${d.lon}`,
    lat: parseFloat(d.lat),
    lon: parseFloat(d.lon),
    type: d.addresstype ?? d.type,
  }));
}

/**
 * Обратное геокодирование до уровня региона (zoom=5 ≈ область/штат).
 * Регион определяется автоматически и не редактируется пользователем.
 */
export async function reverseRegion(
  latitude: number,
  longitude: number
): Promise<RegionInfo | null> {
  const url =
    `${NOMINATIM}/reverse?format=jsonv2&zoom=5&addressdetails=1` +
    `&accept-language=ru&lat=${latitude}&lon=${longitude}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`reverse geocoder: ${res.status}`);
  const d = (await res.json()) as {
    address?: Record<string, string | undefined>;
  };
  const a = d.address ?? {};
  const name =
    a.state || a.state_district || a.region || a.county || a.country || null;
  const country =
    typeof a.country_code === "string" && a.country_code.length === 2
      ? a.country_code.toUpperCase()
      : null;
  if (!name && !country) return null;
  return { country: country ?? "—", name: name ?? "регион не определён" };
}

/** Высота над уровнем моря (Open-Meteo). Недоступна → null. */
export async function fetchElevation(
  latitude: number,
  longitude: number
): Promise<number | null> {
  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/elevation?latitude=${latitude}&longitude=${longitude}`
    );
    if (!res.ok) return null;
    const d = (await res.json()) as { elevation?: number | number[] };
    const e = Array.isArray(d.elevation) ? d.elevation[0] : d.elevation;
    return typeof e === "number" && Number.isFinite(e) ? Math.round(e) : null;
  } catch {
    return null;
  }
}
