"use strict";

/**
 * grib-api — минимальный бэкенд для Mycoscope/Grib.
 *
 * Реализует ровно то, чего ждёт фронтенд (см. src/lib/api.ts, observation.ts):
 *
 *   POST /api/observations
 *   Content-Type: application/json
 *   ← 200 { "success": true,  "observation_id": "<uuid>" }
 *   ← 400 { "success": false, "error": "validation_error" }
 *   ← 5xx { "success": false, "error": "<текст>" }
 *
 *   GET /api/health
 *   ← 200 { "status": "ok" }
 *
 * Хранение: append-only JSON-файлы, один файл — одно наблюдение.
 * Файл никогда не перезаписывается (флаг "wx" при записи).
 * Повторная отправка с тем же observation_id (например, ретрай сети)
 * не считается ошибкой — если файл уже существует, отвечаем success:true.
 *
 * Письмо с копией JSON отправляется только если:
 *   - в наблюдении указан observer.email,
 *   - и заданы переменные окружения SMTP_HOST/SMTP_USER/SMTP_PASS.
 * Если SMTP не настроен — письмо просто не отправляется, это не ошибка
 * (сама отправка наблюдения на сервер не должна зависеть от почты).
 */

const express = require("express");
const fs = require("fs/promises");
const path = require("path");
const { handleWeather } = require("./weather");

const PORT = Number(process.env.PORT || 8030);
const DATA_DIR =
  process.env.DATA_DIR || path.join(__dirname, "data", "observations");

const DATASET_TYPE = "mycoscope";
const MATURITY_VALUES = new Set([
  "fresh",
  "mostly_fresh",
  "mostly_old",
  "mixed",
]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayISO() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function formatDateRu(iso) {
  if (!DATE_RE.test(iso)) return iso;
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Серверная валидация. Дублирует client-side validateForm/buildObservation
 * из фронтенда, но работает по итоговому JSON, а не по форме.
 * Возвращает null, если всё ок, иначе строку с причиной (для логов;
 * наружу уходит только generic "validation_error").
 */
function validateObservation(body) {
  if (!body || typeof body !== "object") return "body is not an object";

  if (body.dataset_type !== DATASET_TYPE) return "bad dataset_type";
  if (!isNonEmptyString(body.version)) return "bad version";
  if (!isNonEmptyString(body.observation_id) || !UUID_RE.test(body.observation_id))
    return "bad observation_id";
  if (!isNonEmptyString(body.observation_date) || !DATE_RE.test(body.observation_date))
    return "bad observation_date";
  if (body.observation_date > todayISO()) return "observation_date in future";
  if (!isNonEmptyString(body.created_at) || Number.isNaN(Date.parse(body.created_at)))
    return "bad created_at";

  const loc = body.location;
  if (!loc || typeof loc !== "object") return "bad location";
  if (!isFiniteNumber(loc.latitude) || loc.latitude < -90 || loc.latitude > 90)
    return "bad latitude";
  if (!isFiniteNumber(loc.longitude) || loc.longitude < -180 || loc.longitude > 180)
    return "bad longitude";
  if (loc.elevation !== null && !isFiniteNumber(loc.elevation))
    return "bad elevation";
  if (!loc.region || typeof loc.region !== "object") return "bad region";
  if (loc.region.country !== null && typeof loc.region.country !== "string")
    return "bad region.country";
  if (loc.region.name !== null && typeof loc.region.name !== "string")
    return "bad region.name";

  const observer = body.observer;
  if (!observer || typeof observer !== "object") return "bad observer";
  if (observer.email !== null) {
    if (!isNonEmptyString(observer.email) || !EMAIL_RE.test(observer.email.trim()))
      return "bad observer.email";
  }

  if (!Array.isArray(body.mushrooms) || body.mushrooms.length === 0)
    return "mushrooms must be a non-empty array";

  for (const row of body.mushrooms) {
    if (!row || typeof row !== "object") return "bad mushroom row";
    const sp = row.species;
    if (!sp || typeof sp !== "object") return "bad species";
    const sci = sp.scientific_name;
    const sciOk =
      isNonEmptyString(sci) ||
      (Array.isArray(sci) && sci.length > 0 && sci.every(isNonEmptyString));
    if (!sciOk) return "bad species.scientific_name";
    if (!isNonEmptyString(sp.common_name_ru)) return "bad species.common_name_ru";
    if (row.species_present_at_location !== true)
      return "species_present_at_location must be true";

    const h = row.harvest;
    if (!h || typeof h !== "object") return "bad harvest";
    if (h.status === "present") {
      if (![1, 2, 3, 4, 5].includes(h.abundance)) return "bad harvest.abundance";
      if (!MATURITY_VALUES.has(h.maturity)) return "bad harvest.maturity";
      if (![0, 1, 2, 3].includes(h.worm_damage)) return "bad harvest.worm_damage";
    } else if (h.status !== "absent") {
      return "bad harvest.status";
    }
    if (typeof row.comment !== "string") return "bad row.comment";
  }

  if (typeof body.general_comment !== "string") return "bad general_comment";

  if (!body.source || typeof body.source !== "object") return "bad source";
  if (!isNonEmptyString(body.source.application)) return "bad source.application";
  if (!isNonEmptyString(body.source.application_version))
    return "bad source.application_version";

  return null;
}

async function saveObservation(body) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const file = path.join(DATA_DIR, `${body.observation_id}.json`);
  try {
    // "wx" — не перезаписывать существующий файл (append-only гарантия).
    await fs.writeFile(file, JSON.stringify(body, null, 2), { flag: "wx" });
    return { alreadyExisted: false };
  } catch (err) {
    if (err.code === "EEXIST") {
      // Повторная отправка того же observation_id (например, ретрай сети
      // после таймаута). Данные уже сохранены — не ошибка.
      return { alreadyExisted: true };
    }
    throw err;
  }
}

/**
 * Отправка копии JSON на email наблюдателя. Не бросает исключение наружу —
 * ошибки почты не должны ронять сохранение наблюдения.
 */
async function maybeSendEmail(body) {
  const to = body.observer && body.observer.email;
  if (!to) return;

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.log(`[mail] SMTP не настроен — письмо на ${to} не отправлено`);
    return;
  }

  let nodemailer;
  try {
    nodemailer = require("nodemailer");
  } catch {
    console.warn("[mail] пакет nodemailer не установлен — письмо пропущено");
    return;
  }

  try {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT || 587),
      secure: Number(SMTP_PORT || 587) === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 10_000,
    });

    await transporter.sendMail({
      from: SMTP_FROM || SMTP_USER,
      to,
      subject: `Grib / Mycoscope — наблюдение от ${formatDateRu(body.observation_date)}`,
      text:
        "Во вложении JSON вашего наблюдения. Запись сохранена в журнале и " +
        "больше не может быть изменена или удалена.",
      attachments: [
        {
          filename: `${body.observation_id}.json`,
          content: JSON.stringify(body, null, 2),
          contentType: "application/json",
        },
      ],
    });
    console.log(`[mail] отправлено на ${to}`);
  } catch (err) {
    console.error(`[mail] не удалось отправить на ${to}:`, err.message);
  }
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "256kb" }));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.post("/api/weather", handleWeather);

app.post("/api/observations", async (req, res) => {
  const reason = validateObservation(req.body);
  if (reason) {
    console.warn(`[validation] отклонено: ${reason}`);
    return res.status(400).json({ success: false, error: "validation_error" });
  }

  try {
    await saveObservation(req.body);
  } catch (err) {
    console.error("[save] ошибка записи файла:", err);
    return res
      .status(500)
      .json({ success: false, error: "storage_error" });
  }

  // Почта не должна блокировать ответ пользователю: наблюдение уже
  // физически сохранено на диске, и клиент должен узнать об этом сразу,
  // не дожидаясь (и тем более не завися от) внешнего SMTP-соединения,
  // которое может зависать на десятки секунд/минуты (например, если
  // хостер блокирует исходящий SMTP-трафик). Отправляем письмо в фоне,
  // уже после ответа клиенту.
  res.json({ success: true, observation_id: req.body.observation_id });
  maybeSendEmail(req.body).catch((err) => {
    console.error("[mail] неожиданная ошибка вне maybeSendEmail:", err);
  });
});

// JSON parser бросает SyntaxError на битом теле запроса — тоже 400,
// а не 500, и в правильном формате, который понимает фронтенд.
app.use((err, _req, res, _next) => {
  if (err.type === "entity.parse.failed" || err instanceof SyntaxError) {
    return res.status(400).json({ success: false, error: "validation_error" });
  }
  console.error("[unhandled]", err);
  res.status(500).json({ success: false, error: "internal_error" });
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`grib-api listening on 127.0.0.1:${PORT}, data dir: ${DATA_DIR}`);
});
