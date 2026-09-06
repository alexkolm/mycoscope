import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { HeaderBubbles } from "./components/HeaderBubbles";
import { MapPicker } from "./components/MapPicker";
import { SpeciesSheet } from "./components/SpeciesSheet";
import { MushroomRow } from "./components/MushroomRow";
import { JsonPreview } from "./components/JsonPreview";
import { ToastStack, type ToastItem } from "./components/Toasts";
import {
  IconAlert,
  IconCalendar,
  IconCheck,
  IconCloud,
  IconCopy,
  IconDownload,
  IconLeaf,
  IconMail,
  IconMushroomLogo,
  IconPin,
  IconPlus,
  IconSend,
  IconSpinner,
} from "./components/icons";
import {
  buildObservation,
  daysAgoISO,
  formatDateRu,
  SPECIES_LIST,
  todayISO,
  uuidv4,
  validateForm,
  type ObservationPayload,
} from "./lib/observation";
import { submitObservation } from "./lib/api";
import type {
  FormErrors,
  FormState,
  LocationState,
  RowState,
} from "./lib/types";

/* ---------------------------------- helpers --------------------------------- */

function downloadJson(obj: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function SectionHead({
  num,
  title,
  note,
}: {
  num: string;
  title: string;
  note?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="font-display text-xl leading-none text-chanterelle-600">{num}</span>
      <h2 className="font-display text-[26px] leading-tight text-pine-950 sm:text-3xl">
        {title}
      </h2>
      {note && <span className="text-[12px] text-ink-soft">{note}</span>}
    </div>
  );
}

function InlineError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return (
    <p className="mt-2 flex items-start gap-1.5 text-[12.5px] font-medium text-brick-600">
      <IconAlert size={14} className="mt-px shrink-0" />
      {msg}
    </p>
  );
}

interface SavedInfo {
  id: string;
  mode: "server" | "local";
  email: string;
  date: string;
}

/* ----------------------------------- app ------------------------------------ */

export default function App() {
  const [form, setForm] = useState<FormState>({
    location: null,
    date: todayISO(),
    email: "",
    generalComment: "",
    rows: [],
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [preview, setPreview] = useState<ObservationPayload | null>(null);
  const [previewDirty, setPreviewDirty] = useState(false);
  const [sending, setSending] = useState(false);
  const [savedInfo, setSavedInfo] = useState<SavedInfo | null>(null);
  const [lastRecord, setLastRecord] = useState<ObservationPayload | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [sheet, setSheet] = useState<{ rowId: string | null } | null>(null);

  const previewRef = useRef<ObservationPayload | null>(null);
  useEffect(() => {
    previewRef.current = preview;
  }, [preview]);

  const toastId = useRef(0);
  const notify = useCallback(
    (text: string, tone: ToastItem["tone"] = "info") => {
      const id = ++toastId.current;
      setToasts((t) => [...t.slice(-2), { id, text, tone }]);
      window.setTimeout(
        () => setToasts((t) => t.filter((x) => x.id !== id)),
        6500
      );
    },
    []
  );

  /* форма изменилась после «Готово» → JSON устарел, отправка блокируется */
  const skipFirst = useRef(true);
  useEffect(() => {
    if (skipFirst.current) {
      skipFirst.current = false;
      return;
    }
    if (previewRef.current) setPreviewDirty(true);
  }, [form]);

  /* scroll reveal секций */
  useEffect(() => {
    const els = Array.from(
      document.querySelectorAll<HTMLElement>(".reveal:not(.on)")
    );
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("on");
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.08, rootMargin: "0px 0px -6% 0px" }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [form.rows.length, preview, savedInfo]);

  /* ------------------------------- form actions ------------------------------ */

  const handleLocationChange = useCallback((loc: LocationState) => {
    setForm((f) => ({ ...f, location: loc }));
    setErrors((e) => (e.location ? { ...e, location: undefined } : e));
  }, []);

  /**
   * Открывает страницу "Архив погоды" в новом окне, пробрасывая точку
   * (раздел 1) и дату (раздел 2) через query-параметры URL — сама
   * страница независимая (свой Vite-entry, weather-archive.html) и сама
   * ходит в /api/weather за данными Open-Meteo.
   */
  const openWeatherArchive = useCallback(() => {
    if (!form.location) return;
    const params = new URLSearchParams({
      lat: String(form.location.latitude),
      lon: String(form.location.longitude),
    });
    if (form.location.elevation != null) {
      params.set("elevation", String(form.location.elevation));
    }
    if (form.location.region) {
      params.set("region_name", form.location.region.name ?? "");
      params.set("region_country", form.location.region.country ?? "");
    }
    if (form.date) {
      params.set("date", form.date);
    }
    window.open(`/weather-archive.html?${params.toString()}`, "_blank", "noopener,noreferrer");
  }, [form.location, form.date]);

  function addRow(speciesIndex: number) {
    const row: RowState = {
      id: uuidv4(),
      speciesIndex,
      status: "present",
      abundance: 3,
      maturity: "fresh",
      wormDamage: 0,
      comment: "",
    };
    setForm((f) => ({ ...f, rows: [...f.rows, row] }));
    setErrors((e) => ({ ...e, rows: undefined, rowIssues: undefined }));
  }

  function patchRow(id: string, patch: Partial<RowState>) {
    setForm((f) => ({
      ...f,
      rows: f.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    }));
    setErrors((e) => ({ ...e, rows: undefined, rowIssues: undefined }));
  }

  function removeRow(id: string) {
    const row = form.rows.find((r) => r.id === id);
    setForm((f) => ({ ...f, rows: f.rows.filter((r) => r.id !== id) }));
    if (row) {
      notify(
        `Строка «${SPECIES_LIST[row.speciesIndex]?.common_name_ru ?? "вид"}» удалена из анкеты.`,
        "info"
      );
    }
  }

  function handlePickSpecies(index: number) {
    if (!sheet) return;
    if (sheet.rowId) {
      patchRow(sheet.rowId, { speciesIndex: index });
      notify(`Вид заменён: ${SPECIES_LIST[index].common_name_ru}.`, "success");
    } else {
      addRow(index);
    }
    setSheet(null);
  }

  /* ------------------------------ «Готово» / «Отправить» ------------------------------ */

  function scrollToId(id: string) {
    document
      .getElementById(id)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function handleFinish() {
    const errs = validateForm(form);
    setErrors(errs);
    const hasErrors =
      errs.location || errs.date || errs.rows || errs.rowIssues || errs.email;
    if (hasErrors) {
      notify(
        "Проверьте форму: есть незаполненные или некорректные поля.",
        "error"
      );
      if (errs.location) scrollToId("sec-location");
      else if (errs.date) scrollToId("sec-date");
      else if (errs.rows || errs.rowIssues) scrollToId("sec-rows");
      else if (errs.email) scrollToId("sec-notes");
      return;
    }
    try {
      const payload = buildObservation(
        form,
        uuidv4(),
        new Date().toISOString()
      );
      setPreview(payload);
      setPreviewDirty(false);
      notify(
        "JSON сформирован. Проверьте данные — они ещё не отправлены.",
        "success"
      );
      window.setTimeout(() => scrollToId("sec-preview"), 80);
    } catch {
      notify("Не удалось сформировать JSON. Проверьте анкету.", "error");
    }
  }

  function resetForm() {
    setForm({
      location: null,
      date: todayISO(),
      email: "",
      generalComment: "",
      rows: [],
    });
    setPreview(null);
    setPreviewDirty(false);
    setErrors({});
  }

  /**
   * true, если в анкете уже есть данные, которые будут потеряны при
   * сбросе — используется, чтобы (а) показывать кнопку "Новое наблюдение"
   * только когда она реально нужна, и (б) спрашивать подтверждение перед
   * тем, как стереть ещё не отправленную анкету.
   */
  const hasUnsavedData =
    !!form.location ||
    form.rows.length > 0 ||
    form.generalComment.trim() !== "" ||
    form.email.trim() !== "" ||
    form.date !== todayISO();

  function handleStartNew() {
    if (hasUnsavedData) {
      const ok = window.confirm(
        "Текущая анкета ещё не отправлена — все введённые данные будут потеряны. Начать новое наблюдение?"
      );
      if (!ok) return;
    }
    resetForm();
    window.scrollTo({ top: 0, behavior: "smooth" });
    notify("Анкета очищена — можно начать новое наблюдение.", "info");
  }

  async function handleSend() {
    if (!preview || previewDirty || sending) return;
    setSending(true);
    // created_at — момент окончательного сохранения
    const payload: ObservationPayload = {
      ...preview,
      created_at: new Date().toISOString(),
    };
    const res = await submitObservation(
      payload as unknown as Record<string, unknown>
    );
    setSending(false);

    if (res.ok) {
      const finalRecord: ObservationPayload = {
        ...payload,
        observation_id: res.observationId,
      };
      setLastRecord(finalRecord);
      setSavedInfo({
        id: res.observationId,
        mode: res.mode,
        email: form.email.trim(),
        date: form.date,
      });
      resetForm();
      window.scrollTo({ top: 0, behavior: "smooth" });
      if (res.mode === "server") {
        notify("Наблюдение сохранено в журнал. Запись неизменяема.", "success");
        if (finalRecord.observer.email) {
          notify(
            `Копия JSON отправлена на ${finalRecord.observer.email}.`,
            "info"
          );
        }
      } else {
        notify(
          "Демо-режим: VPS недоступен, запись добавлена в локальный журнал браузера (append-only).",
          "info"
        );
      }
    } else {
      notify(res.error, "error");
    }
  }

  /* --------------------------------- derived --------------------------------- */

  const usedIndices = useMemo(
    () => new Set(form.rows.map((r) => r.speciesIndex)),
    [form.rows]
  );
  const editingSpeciesIndex = sheet?.rowId
    ? form.rows.find((r) => r.id === sheet.rowId)?.speciesIndex
    : undefined;

  const presentCount = form.rows.filter((r) => r.status === "present").length;

  const steps = [
    {
      label: "Точка",
      done: !!form.location && !form.location.regionPending,
    },
    { label: "Дата", done: !!form.date && form.date <= todayISO() },
    { label: "Виды", done: form.rows.length > 0 },
    { label: "JSON", done: !!preview && !previewDirty },
  ];

  const status = savedInfo
    ? { dot: "bg-pine-500", text: "запись сохранена", cls: "text-pine-700 border-pine-300 bg-pine-100/70" }
    : preview && !previewDirty
      ? { dot: "bg-chanterelle-500", text: "JSON готов", cls: "text-pine-900 border-chanterelle-300 bg-chanterelle-100/70" }
      : preview && previewDirty
        ? { dot: "bg-chanterelle-500", text: "JSON устарел", cls: "text-pine-900 border-chanterelle-300 bg-chanterelle-100/70" }
        : { dot: "bg-pine-300", text: "черновик", cls: "text-ink-soft border-line bg-pine-50" };

  /* ---------------------------------- render ---------------------------------- */

  return (
    <div className="relative min-h-screen">
      <ToastStack toasts={toasts} onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />

      {/* шапка */}
      <header className="sticky top-0 z-40 overflow-hidden border-b border-line/90 bg-card/90 backdrop-blur-md">
        <HeaderBubbles />
        <div className="relative z-10 mx-auto flex min-h-16 w-full max-w-6xl items-center justify-between gap-4 px-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-pine-900 text-chanterelle-300 shadow-sm">
              <IconMushroomLogo size={22} />
            </span>
            <div className="min-w-0">
              <div className="font-display text-[17px] tracking-tight text-pine-950 sm:text-[19px]">
                Mycoscope
              </div>
              <div className="hidden font-mono text-[9.5px] tracking-[0.12em] text-ink-soft uppercase sm:block">
                полевой журнал грибных наблюдений
              </div>
            </div>
          </div>
          <div
            className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors ${status.cls}`}
          >
            <span className={`pulse-dot h-1.5 w-1.5 rounded-full ${status.dot}`} />
            {status.text}
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-6xl px-4 pb-36 sm:pb-32">
        {/* журнальная лента */}
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5 border-b-2 border-pine-200 pb-8 pt-8 sm:pt-10">
          <div>
            <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.24em] text-chanterelle-600">
              <IconLeaf size={13} /> полевой журнал грибных наблюдений
            </p>
            <h1 className="mt-2.5 font-display text-[34px] leading-[1.05] text-pine-950 sm:text-5xl">
              Новое наблюдение
            </h1>
            <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-ink-soft sm:text-[14.5px]">
              Вернулись из леса — зафиксируйте точку, дату и урожай по каждому
              виду. После «Отправить» запись станет неизменяемой частью журнала:
              исправить или удалить её будет нельзя.
            </p>
          </div>
          <div className="flex flex-col items-start gap-3 sm:items-end">
            {hasUnsavedData && (
              <button
                type="button"
                onClick={handleStartNew}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-card px-3.5 text-[12.5px] font-medium text-ink-soft transition-colors hover:border-brick-500/40 hover:text-brick-600 active:scale-[0.97]"
                title="Очистить анкету и начать заполнение новой, не отправляя текущую"
              >
                <IconPlus size={14} />
                Новое наблюдение
              </button>
            )}
            <div className="hidden text-right font-mono text-[11px] leading-[1.8] text-ink-soft sm:block">
              MVP v1.0 · append-only
              <br />
              dataset_type: mycoscope
              <br />
              справочник: 10 видов
            </div>
          </div>
        </div>

        {/* шаги */}
        <ol className="mt-5 flex flex-wrap gap-2" aria-label="Готовность анкеты">
          {steps.map((s, i) => (
            <li
              key={s.label}
              className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-all duration-300 ${
                s.done
                  ? "border-pine-300/40 bg-pine-300/10 text-pine-700"
                  : "border-line bg-card text-ink-soft"
              }`}
            >
              {s.done ? (
                <IconCheck size={13} />
              ) : (
                <span className="font-mono text-[10.5px]">{i + 1}</span>
              )}
              {s.label}
            </li>
          ))}
        </ol>

        <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-8">
          {/* ============================ колонка формы ============================ */}
          <div className="min-w-0">
            {/* успех */}
            <AnimatePresence>
              {savedInfo && (
                <motion.section
                  key="saved"
                  initial={{ opacity: 0, y: 24 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -16 }}
                  className="reveal on mb-10 overflow-hidden rounded-xl border border-pine-300/35 bg-card shadow-sm"
                >
                  <div className="border-b border-pine-300/20 bg-pine-300/8 px-5 py-5 sm:px-6">
                    <div className="flex items-start gap-4">
                      <span className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-pine-300/40 bg-pine-300/15 text-pine-700">
                        <IconCheck size={22} />
                      </span>
                      <div className="min-w-0">
                        <h2 className="font-display text-2xl text-pine-950">
                          Наблюдение сохранено
                        </h2>
                        <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
                          Запись добавлена в журнал{" "}
                          {savedInfo.mode === "server"
                            ? "на сервере"
                            : "браузера (демо: VPS недоступен)"}{" "}
                          и больше не может быть изменена или удалена.
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="grid gap-3 px-5 py-5 text-[13px] sm:px-6">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-ink-soft">observation_id:</span>
                      <code className="min-w-0 flex-1 truncate rounded border border-moss-600/60 bg-moss-950 px-2.5 py-1.5 font-mono text-[11.5px] text-chanterelle-300">
                        {savedInfo.id}
                      </code>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(savedInfo.id);
                            notify("ID скопирован.", "success");
                          } catch {
                            notify("Не удалось скопировать ID.", "error");
                          }
                        }}
                        className="rounded-md border border-moss-600/60 p-2 text-ink-soft transition-all hover:border-chanterelle-500/40 hover:text-pine-950 active:scale-95"
                        aria-label="Скопировать ID"
                      >
                        <IconCopy size={15} />
                      </button>
                    </div>
                    <p className="text-ink-soft">
                      <span className="text-ink-soft">Наблюдение от:</span>{" "}
                      <span className="font-semibold text-pine-950">
                        {formatDateRu(savedInfo.date)}
                      </span>
                      <span className="mx-2 text-moss-600">·</span>
                      <span className="text-ink-soft">Файл:</span>{" "}
                      <span className="font-mono text-[12px] text-pine-950">
                        {savedInfo.id.slice(0, 8)}….json
                      </span>
                    </p>
                    <p className="flex items-start gap-2 text-ink-soft">
                      <IconMail size={15} className="mt-0.5 shrink-0 text-ink-soft" />
                      {savedInfo.email
                        ? savedInfo.mode === "server"
                          ? `Копия JSON отправлена на ${savedInfo.email}. Тема письма: «Grib / Mycoscope — наблюдение от ${formatDateRu(savedInfo.date)}».`
                          : `Демо-режим: письмо на ${savedInfo.email} не отправляется (нет SMTP-сервера).`
                        : "Email не указан — письмо не отправлялось."}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {lastRecord && (
                        <button
                          type="button"
                          onClick={() =>
                            downloadJson(lastRecord, `${savedInfo.id}.json`)
                          }
                          className="inline-flex h-11 items-center gap-2 rounded-md border border-moss-600/60 bg-card px-4 text-[13px] font-medium text-ink transition-all hover:border-chanterelle-500/40 hover:text-pine-950 active:scale-[0.98]"
                        >
                          <IconDownload size={15} /> Скачать JSON
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setSavedInfo(null)}
                        className="inline-flex h-11 items-center gap-2 rounded-md bg-chanterelle-500 px-5 text-[13px] font-semibold text-[#1c1207] transition-all hover:bg-chanterelle-400 active:scale-[0.98]"
                      >
                        <IconPlus size={15} /> Новое наблюдение
                      </button>
                    </div>
                  </div>
                </motion.section>
              )}
            </AnimatePresence>

            {/* 01 · точка */}
            <section id="sec-location" className="reveal scroll-mt-24">
              <SectionHead
                num="01"
                title="Точка сбора"
                note="карта · поиск · регион определится сам"
              />
              <MapPicker
                value={form.location}
                onChange={handleLocationChange}
                notify={notify}
              />
              <InlineError msg={errors.location} />
            </section>

            {/* 02 · дата */}
            <section id="sec-date" className="reveal mt-12 scroll-mt-24">
              <SectionHead
                num="02"
                title="Дата наблюдения"
                note="день фактического выхода, не заполнения"
              />
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative sm:w-64">
                  <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-soft">
                    <IconCalendar size={17} />
                  </span>
                  <input
                    type="date"
                    value={form.date}
                    max={todayISO()}
                    onChange={(e) => {
                      setForm((f) => ({ ...f, date: e.target.value }));
                      setErrors((er) => ({ ...er, date: undefined }));
                    }}
                    className={`h-12 w-full rounded-md border bg-moss-800/70 pl-10 pr-3 font-mono text-[14.5px] text-pine-950 transition-colors ${
                      errors.date
                        ? "border-brick-500/60"
                        : "border-moss-600/60 focus:border-chanterelle-500/60"
                    }`}
                    aria-label="Дата наблюдения"
                  />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { label: "Сегодня", days: 0 },
                    { label: "Вчера", days: 1 },
                    { label: "3 дня назад", days: 3 },
                    { label: "Неделю назад", days: 7 },
                  ].map((q) => {
                    const iso = daysAgoISO(q.days);
                    const active = form.date === iso;
                    return (
                      <button
                        key={q.label}
                        type="button"
                        onClick={() => {
                          setForm((f) => ({ ...f, date: iso }));
                          setErrors((er) => ({ ...er, date: undefined }));
                        }}
                        className={`h-9 rounded-full border px-3.5 text-[12.5px] font-medium transition-all active:scale-95 ${
                          active
                            ? "border-chanterelle-400/60 bg-chanterelle-500/15 text-pine-900"
                            : "border-line bg-card text-ink-soft hover:border-chanterelle-500/50 hover:text-pine-950"
                        }`}
                      >
                        {q.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <InlineError msg={errors.date} />
              <p className="mt-2 text-[12px] text-ink-soft">
                Будущие даты недоступны: запись описывает уже состоявшийся выход.
              </p>

              <div className="mt-4 border-t border-line/70 pt-4">
                <button
                  type="button"
                  onClick={openWeatherArchive}
                  disabled={!form.location}
                  title={
                    form.location
                      ? "Открыть архив погоды Open-Meteo для выбранной точки в новом окне"
                      : "Сначала выберите точку сбора в разделе 01"
                  }
                  className={`flex h-11 items-center gap-2 rounded-full border px-4 text-[13.5px] font-medium transition-colors active:scale-[0.97] ${
                    form.location
                      ? "border-chanterelle-500/50 bg-chanterelle-500/12 text-pine-950 hover:bg-chanterelle-500/20"
                      : "cursor-not-allowed border-line bg-card text-ink-soft/50"
                  }`}
                >
                  <IconCloud size={16} />
                  Архив погоды
                </button>
                <p className="mt-2 text-[12px] text-ink-soft">
                  Оценка условий плодоношения на основе данных Open Meteo. Формирование
                  промта для нейросетевого анализа по видам грибов.
                </p>
                {!form.location && (
                  <p className="mt-1.5 text-[12px] text-ink-soft">
                    Станет доступно после выбора точки в разделе 01.
                  </p>
                )}
              </div>
            </section>

            {/* 03 · анкета */}
            <section id="sec-rows" className="reveal mt-12 scroll-mt-24">
              <SectionHead
                num="03"
                title="Грибная анкета"
                note={
                  form.rows.length > 0
                    ? `видов: ${form.rows.length} из ${SPECIES_LIST.length}`
                    : "вид → урожай → количество → состояние → червивость"
                }
              />

              {form.rows.length === 0 && (
                <div className="rounded-lg border border-dashed border-line bg-card px-5 py-8 text-center">
                  <IconMushroomLogo size={34} className="mx-auto opacity-70" />
                  <p className="mt-3 text-[14px] font-medium text-ink-soft">
                    В анкете пока пусто
                  </p>
                  <p className="mx-auto mt-1 max-w-md text-[12.5px] leading-relaxed text-ink-soft">
                    Добавьте вид — это само по себе означает: «встречается в
                    выбранной точке». Если вида нет в списке, значит вы его здесь
                    не находили.
                  </p>
                </div>
              )}

              <InlineError msg={errors.rows} />

              <div className="mt-3 grid gap-3">
                <AnimatePresence initial={false}>
                  {form.rows.map((row, i) => (
                    <MushroomRow
                      key={row.id}
                      row={row}
                      index={i}
                      error={errors.rowIssues?.[row.id]}
                      onPatch={(p) => patchRow(row.id, p)}
                      onRemove={() => removeRow(row.id)}
                      onChangeSpecies={() => setSheet({ rowId: row.id })}
                    />
                  ))}
                </AnimatePresence>
              </div>

              <button
                type="button"
                onClick={() => setSheet({ rowId: null })}
                disabled={usedIndices.size >= SPECIES_LIST.length}
                className="mt-3 flex h-14 w-full items-center justify-center gap-2.5 rounded-lg border-2 border-dashed border-moss-600/70 text-[14px] font-semibold text-ink-soft transition-all hover:border-chanterelle-500/50 hover:bg-chanterelle-500/5 hover:text-chanterelle-700 active:scale-[0.995] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <IconPlus size={17} />
                Добавить гриб
                <span className="font-mono text-[11.5px] font-normal text-ink-soft">
                  {usedIndices.size}/{SPECIES_LIST.length}
                </span>
              </button>
            </section>

            {/* 04 · комментарии и email */}
            <section id="sec-notes" className="reveal mt-12 scroll-mt-24">
              <SectionHead
                num="04"
                title="Комментарий и email"
                note="оба поля необязательны"
              />
              <div className="grid gap-5">
                <div>
                  <label
                    htmlFor="general-comment"
                    className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft"
                  >
                    Общий комментарий к выходу
                  </label>
                  <textarea
                    id="general-comment"
                    value={form.generalComment}
                    maxLength={1000}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, generalComment: e.target.value }))
                    }
                    rows={3}
                    placeholder="Например: ходил после дождя. Лес преимущественно сосновый, почва на открытых местах сухая…"
                    className="w-full resize-y rounded-md border border-moss-600/60 bg-moss-800/70 px-3.5 py-3 text-[14px] leading-relaxed text-pine-950 placeholder:text-ink-soft/80 transition-colors focus:border-chanterelle-500/60"
                  />
                  <p className="mt-1 text-right font-mono text-[10.5px] text-ink-soft">
                    {form.generalComment.length}/1000
                  </p>
                </div>

                <div>
                  <label
                    htmlFor="observer-email"
                    className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft"
                  >
                    <IconMail size={13} /> Email (необязательно)
                  </label>
                  <input
                    id="observer-email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    value={form.email}
                    onChange={(e) => {
                      setForm((f) => ({ ...f, email: e.target.value }));
                      setErrors((er) => ({ ...er, email: undefined }));
                    }}
                    placeholder="you@example.com"
                    className={`h-12 w-full rounded-md border bg-moss-800/70 px-3.5 text-[14.5px] text-pine-950 placeholder:text-ink-soft/80 transition-colors sm:max-w-sm ${
                      errors.email
                        ? "border-brick-500/60"
                        : "border-moss-600/60 focus:border-chanterelle-500/60"
                    }`}
                  />
                  <InlineError msg={errors.email} />
                  <p className="mt-2 max-w-lg text-[12px] leading-relaxed text-ink-soft">
                    Если указать адрес, после сохранения сервер пришлёт копию
                    JSON. Тема письма:{" "}
                    <span className="font-mono text-[11px] text-ink-soft">
                      Grib / Mycoscope — наблюдение от{" "}
                      {form.date ? formatDateRu(form.date) : "…"}
                    </span>
                    , вложение —{" "}
                    <span className="font-mono text-[11px] text-ink-soft">
                      &lt;uuid&gt;.json
                    </span>
                    .
                  </p>
                </div>
              </div>
            </section>

            {/* предпросмотр JSON */}
            {preview && (
              <section id="sec-preview" className="mt-12 scroll-mt-24">
                <div className="mb-5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-display text-xl leading-none text-chanterelle-600">
                    05
                  </span>
                  <h2 className="font-display text-[26px] leading-tight text-pine-950 sm:text-3xl">
                    Проверьте JSON
                  </h2>
                  <span className="text-[12px] text-ink-soft">
                    данные ещё не сохранены
                  </span>
                </div>

                {previewDirty && (
                  <div className="mb-3 flex items-start gap-2.5 rounded-md border border-chanterelle-300/35 bg-chanterelle-400/10 px-4 py-3 text-[13px] leading-snug text-pine-900">
                    <IconAlert size={16} className="mt-0.5 shrink-0" />
                    <span>
                      Анкета изменилась после формирования JSON — нажмите{" "}
                      <b>«Готово»</b> ещё раз, иначе отправить не получится.
                    </span>
                  </div>
                )}

                <JsonPreview payload={preview} notify={notify} />

                <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <button
                    type="button"
                    onClick={handleSend}
                    disabled={previewDirty || sending}
                    className="inline-flex h-13 items-center justify-center gap-2.5 rounded-md bg-chanterelle-500 px-7 text-[15px] font-bold text-[#1c1207] shadow-glow-rust transition-all hover:bg-chanterelle-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none"
                  >
                    {sending ? (
                      <>
                        <IconSpinner size={17} /> Сохраняем…
                      </>
                    ) : previewDirty ? (
                      <>
                        <IconSend size={16} /> Сначала «Готово»
                      </>
                    ) : (
                      <>
                        <IconSend size={16} /> Отправить
                      </>
                    )}
                  </button>
                  <p className="text-[12px] leading-relaxed text-ink-soft">
                    POST /api/observations · сервер повторно валидирует JSON и
                    создаст запись{" "}
                    <span className="font-mono text-[11px]">
                      /grib/data/observations/&lt;uuid&gt;.json
                    </span>
                  </p>
                </div>
              </section>
            )}
          </div>

          {/* ============================ сводка (desktop) ============================ */}
          <aside className="hidden lg:block">
            <div className="sticky top-24 space-y-4">
              <div className="rounded-lg border border-line bg-card p-5 shadow-lift">
                <h3 className="flex items-center gap-2 font-display text-lg text-pine-950">
                  <IconLeaf size={15} className="text-chanterelle-600" />
                  Сводка выхода
                </h3>
                <dl className="mt-4 grid gap-3 text-[12.5px]">
                  <div>
                    <dt className="text-ink-soft">Точка</dt>
                    <dd className="mt-0.5 font-mono text-[11.5px] text-pine-950">
                      {form.location
                        ? `${form.location.latitude.toFixed(5)}, ${form.location.longitude.toFixed(5)}`
                        : "— не выбрана"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-soft">Регион</dt>
                    <dd className="mt-0.5 font-medium text-pine-950">
                      {form.location?.regionPending
                        ? "определяем…"
                        : form.location?.region
                          ? `${form.location.region.name}, ${form.location.region.country}`
                          : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-soft">Высота</dt>
                    <dd className="mt-0.5 text-pine-950">
                      {form.location?.elevation != null
                        ? `${form.location.elevation} м над у. м.`
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-soft">Дата</dt>
                    <dd className="mt-0.5 font-mono text-pine-950">
                      {form.date ? formatDateRu(form.date) : "—"}
                    </dd>
                  </div>
                </dl>

                <div className="mt-4 border-t border-line pt-4">
                  <p className="flex items-center justify-between text-[12.5px]">
                    <span className="text-ink-soft">Виды в анкете</span>
                    <span className="font-mono text-pine-950">
                      {form.rows.length}/{SPECIES_LIST.length}
                    </span>
                  </p>
                  {form.rows.length > 0 && (
                    <ul className="mt-2.5 grid gap-1.5">
                      {form.rows.map((r) => (
                        <li
                          key={r.id}
                          className="flex items-center gap-2 text-[12px]"
                        >
                          <span
                            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                              r.status === "present" ? "bg-chanterelle-500" : "bg-pine-500"
                            }`}
                          />
                          <span className="truncate text-ink-soft">
                            {SPECIES_LIST[r.speciesIndex]?.common_name_ru}
                          </span>
                          <span className="ml-auto shrink-0 font-mono text-[10.5px] text-ink-soft">
                            {r.status === "present" ? "урожай" : "нет"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {form.rows.length > 0 && (
                    <p className="mt-3 flex items-center gap-2 text-[11.5px] text-ink-soft">
                      <span className="h-1.5 w-1.5 rounded-full bg-chanterelle-400" />
                      урожай есть: {presentCount}
                      <span className="ml-2 h-1.5 w-1.5 rounded-full bg-moss-500" />
                      без урожая: {form.rows.length - presentCount}
                    </p>
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-chanterelle-200 bg-chanterelle-100/60 p-4">
                <p className="text-[11.5px] leading-relaxed text-ink-soft">
                  <span className="font-semibold text-chanterelle-700">Append-only.</span>{" "}
                  Каждая отправка создаёт новый файл{" "}
                  <span className="font-mono text-[10.5px]">&lt;uuid&gt;.json</span>
                  . Старые записи не перезаписываются и не удаляются.
                </p>
              </div>
            </div>
          </aside>
        </div>
      </main>

      {/* нижняя панель действий */}
      {!savedInfo && (
        <div
          className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card/95 backdrop-blur-md"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-3">
            {!preview ? (
              <>
                <button
                  type="button"
                  onClick={handleFinish}
                  className="inline-flex h-13 flex-1 items-center justify-center gap-2 rounded-md bg-chanterelle-500 px-6 text-[15.5px] font-bold text-[#1c1207] shadow-glow-rust transition-all hover:bg-chanterelle-400 active:scale-[0.985] sm:flex-none sm:min-w-52"
                >
                  <IconCheck size={18} /> Готово
                </button>
                <p className="hidden text-[12px] leading-snug text-ink-soft sm:block">
                  Сформирует JSON для проверки.
                  <br />
                  Отправки пока нет.
                </p>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => scrollToId("sec-location")}
                  className="inline-flex h-13 items-center justify-center rounded-md border border-line bg-card px-5 text-[14px] font-medium text-ink-soft transition-all hover:border-chanterelle-500/40 hover:text-pine-950 active:scale-[0.98]"
                >
                  Изменить
                </button>
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={previewDirty || sending}
                  className="inline-flex h-13 flex-1 items-center justify-center gap-2 rounded-md bg-chanterelle-500 px-6 text-[15.5px] font-bold text-[#1c1207] shadow-glow-rust transition-all hover:bg-chanterelle-400 active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none sm:flex-none sm:min-w-52"
                >
                  {sending ? (
                    <>
                      <IconSpinner size={17} /> Сохраняем…
                    </>
                  ) : (
                    <>
                      <IconSend size={17} />
                      {previewDirty ? "Сначала «Готово»" : "Отправить"}
                    </>
                  )}
                </button>
                {previewDirty && (
                  <span className="hidden items-center gap-1.5 text-[12px] font-medium text-chanterelle-700 md:flex">
                    <IconAlert size={13} /> данные изменились
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* подвал */}
      <footer className="relative z-10 mt-4 border-t border-line py-8 pb-28">
        <div className="mx-auto flex w-full max-w-6xl flex-col justify-between gap-4 px-4 text-[12px] leading-relaxed text-ink-soft sm:flex-row">
          <p className="max-w-xl">
            <span className="font-display text-[13px] text-ink-soft">Mycoscope</span>{" "}
            · MVP v1.0 — журнал полевых наблюдений. Каждая успешная отправка
            создаёт новую запись{" "}
            <span className="font-mono text-[11px]">
              /grib/data/observations/&lt;uuid&gt;.json
            </span>
            ; старые записи никогда не перезаписываются.
          </p>
          <p className="shrink-0 font-mono text-[11px] leading-[1.9]">
            <IconPin size={11} className="mr-1 inline text-chanterelle-600" />
            POST /api/observations
            <br />
            схема v1.0 · справочник: 10 видов · без авторизации
          </p>
        </div>
      </footer>

      {/* выбор вида */}
      <SpeciesSheet
        open={sheet !== null}
        onClose={() => setSheet(null)}
        usedIndices={usedIndices}
        editingSpeciesIndex={editingSpeciesIndex}
        onSelect={handlePickSpecies}
      />
    </div>
  );
}
