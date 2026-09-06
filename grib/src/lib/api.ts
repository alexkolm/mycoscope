/**
 * Отправка наблюдения на VPS.
 *
 *   POST /api/observations
 *   Content-Type: application/json
 *   ← { "success": true, "observation_id": "<uuid>" }
 *
 * Путь не содержит "mycoscope": файловая и URL-инфраструктура модуля
 * использует нейтральный префикс grib (бренд остаётся в формате данных).
 */
const API_BASE: string =
  (import.meta as unknown as { env?: Record<string, string> }).env
    ?.VITE_API_BASE ?? "";

const ENDPOINT = `${API_BASE}/api/observations`;
const LOCAL_JOURNAL_KEY = "grib_local_journal_v1";
const TIMEOUT_MS = 9000;

export type SubmitResult =
  | { ok: true; observationId: string; mode: "server" | "local" }
  | { ok: false; error: string };

function fetchWithTimeout(
  url: string,
  init: RequestInit,
  ms: number
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...init, signal: ctrl.signal }).finally(() =>
    window.clearTimeout(timer)
  );
}

/**
 * Append-only демо-журнал в браузере. Используется ТОЛЬКО когда VPS
 * недоступен (например, при статическом демо-хостинге), чтобы полный
 * сценарий «Готово → Отправить → новая запись» оставался рабочим.
 * В продакшене ответ приходит от сервера, и эта ветка не срабатывает.
 */
function appendLocalJournal(record: unknown): void {
  const prev = localStorage.getItem(LOCAL_JOURNAL_KEY);
  const list: unknown[] = prev ? (JSON.parse(prev) as unknown[]) : [];
  list.push(record);
  localStorage.setItem(LOCAL_JOURNAL_KEY, JSON.stringify(list));
}

export async function submitObservation(
  payload: Record<string, unknown>
): Promise<SubmitResult> {
  try {
    const res = await fetchWithTimeout(
      ENDPOINT,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      TIMEOUT_MS
    );

    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const data = (await res.json()) as {
        success?: boolean;
        observation_id?: string;
        error?: string;
      };
      if (data?.success && typeof data.observation_id === "string") {
        return {
          ok: true,
          observationId: data.observation_id,
          mode: "server",
        };
      }
      // Сервер ответил, но отклонил данные — это валидационная ошибка,
      // демо-фолбэк здесь неуместен.
      const detail = data?.error ? ` (${data.error})` : "";
      return {
        ok: false,
        error:
          data?.error === "validation_error"
            ? "Сервер отклонил JSON при проверке (validation_error). Исправьте анкету и повторите отправку."
            : `Сервер не смог сохранить наблюдение${detail}. Данные не удалены — повторите отправку.`,
      };
    }
    throw new Error(`unexpected response: ${res.status}`);
  } catch {
    // VPS недоступен: сеть, таймаут или не-JSON ответ статического хостинга.
    try {
      appendLocalJournal(payload);
      return {
        ok: true,
        observationId: String(payload.observation_id),
        mode: "local",
      };
    } catch {
      return {
        ok: false,
        error:
          "Не удалось сохранить наблюдение. Данные не удалены. Проверьте соединение и повторите отправку.",
      };
    }
  }
}
