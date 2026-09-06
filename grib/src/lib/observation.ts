import SPECIES from "../data/species.json";
import type { FormErrors, FormState, RowState, SpeciesRef } from "./types";
import { processCoordinatesForStorage } from "./geo";

/** Идентификатор формата данных и приложения (не имя файла/каталога). */
export const DATASET_TYPE = "mycoscope";
export const FORMAT_VERSION = "1.0";

/** Фиксированный справочник: 10 видов, алфавитный порядок по-русски. */
export const SPECIES_LIST = SPECIES as SpeciesRef[];

export function uuidv4(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function toISO(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function todayISO(): string {
  return toISO(new Date());
}

export function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return toISO(d);
}

/** 2026-08-14 → 14.08.2026 (для письма и экрана успеха). */
export function formatDateRu(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Клиентская валидация. Сервер (VPS) валидирует JSON повторно. */
export function validateForm(form: FormState): FormErrors {
  const errors: FormErrors = {};

  if (!form.location) {
    errors.location =
      "Отметьте точку на карте или найдите населённый пункт поиском.";
  } else if (form.location.regionPending) {
    errors.location =
      "Регион ещё определяется — подождите секунду и повторите.";
  }

  if (!form.date) {
    errors.date = "Укажите дату наблюдения.";
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) {
    errors.date = "Дата должна быть в формате ГГГГ-ММ-ДД.";
  } else if (form.date > todayISO()) {
    errors.date = "Дата наблюдения не может быть в будущем.";
  }

  if (form.rows.length === 0) {
    errors.rows = "Добавьте хотя бы один вид в анкету.";
  }

  const rowIssues: Record<string, string> = {};
  const seen = new Set<number>();
  for (const row of form.rows) {
    if (row.speciesIndex < 0 || row.speciesIndex >= SPECIES_LIST.length) {
      rowIssues[row.id] = "Вид не выбран.";
    } else if (seen.has(row.speciesIndex)) {
      rowIssues[row.id] = "Этот вид уже есть в анкете — вид нельзя добавлять дважды.";
    }
    if (row.speciesIndex >= 0) seen.add(row.speciesIndex);
  }
  if (Object.keys(rowIssues).length > 0) errors.rowIssues = rowIssues;

  if (form.email.trim().length > 0 && !EMAIL_RE.test(form.email.trim())) {
    errors.email = "Похоже, в email опечатка — проверьте адрес.";
  }

  return errors;
}

function rowToJson(row: RowState) {
  const sp = SPECIES_LIST[row.speciesIndex];
  return {
    species: {
      scientific_name: sp.scientific_name,
      common_name_ru: sp.common_name_ru,
    },
    species_present_at_location: true,
    harvest:
      row.status === "present"
        ? {
            status: "present" as const,
            abundance: row.abundance,
            maturity: row.maturity,
            worm_damage: row.wormDamage,
          }
        : { status: "absent" as const },
    comment: row.comment.trim(),
  };
}

/** Сборка JSON наблюдения (до отправки — только для предпросмотра). */
export function buildObservation(
  form: FormState,
  observationId: string,
  createdAt: string
) {
  const loc = form.location;
  if (!loc) throw new Error("location is required");
  const coords = processCoordinatesForStorage(loc.latitude, loc.longitude);
  const email = form.email.trim();

  return {
    dataset_type: DATASET_TYPE,
    version: FORMAT_VERSION,
    observation_id: observationId,
    observation_date: form.date,
    created_at: createdAt,
    location: {
      latitude: coords.latitude,
      longitude: coords.longitude,
      elevation: loc.elevation,
      region: {
        country: loc.region?.country ?? null,
        name: loc.region?.name ?? null,
      },
    },
    observer: { email: email.length > 0 ? email : null },
    mushrooms: form.rows.map(rowToJson),
    general_comment: form.generalComment.trim(),
    source: {
      application: DATASET_TYPE,
      application_version: FORMAT_VERSION,
    },
  };
}

export type ObservationPayload = ReturnType<typeof buildObservation>;
