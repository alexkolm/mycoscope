import { useMemo } from "react";
import type { ObservationPayload } from "../lib/observation";
import { IconCopy, IconDownload } from "./icons";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Лёгкая подсветка JSON без внешних зависимостей. */
function highlightJson(json: string): string {
  const esc = escapeHtml(json);
  return esc.replace(
    /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false)\b|\bnull\b|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g,
    (match, str?: string, colon?: string) => {
      if (str !== undefined) {
        return colon
          ? `<span class="json-key">${str}</span><span class="json-punct">${colon}</span>`
          : `<span class="json-str">${str}</span>`;
      }
      if (match === "true" || match === "false")
        return `<span class="json-bool">${match}</span>`;
      if (match === "null") return `<span class="json-null">${match}</span>`;
      return `<span class="json-num">${match}</span>`;
    }
  );
}

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

interface Props {
  payload: ObservationPayload;
  notify: (text: string, tone?: "info" | "error" | "success") => void;
}

export function JsonPreview({ payload, notify }: Props) {
  const json = useMemo(() => JSON.stringify(payload, null, 2), [payload]);
  const html = useMemo(() => highlightJson(json), [json]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(json);
      notify("JSON скопирован в буфер обмена.", "success");
    } catch {
      notify("Не удалось скопировать — выделите текст вручную.", "error");
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border border-pine-800 bg-pine-950 shadow-lift">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-pine-700 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="pulse-dot h-2 w-2 rounded-full bg-rust-500" />
          <span className="font-mono text-[12px] font-medium text-pine-200">
            {payload.observation_id.slice(0, 8)}…json
          </span>
          <span className="rounded border border-amberish/30 bg-amberish/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amberish">
            ещё не отправлено
          </span>
        </div>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 rounded-md border border-pine-600 px-2.5 py-1.5 text-[12px] font-medium text-pine-200 transition-all hover:border-chanterelle-500/60 hover:text-paper active:scale-95"
          >
            <IconCopy size={14} /> Копировать
          </button>
          <button
            type="button"
            onClick={() => {
              downloadJson(payload, `${payload.observation_id}.json`);
              notify("Файл скачан: " + payload.observation_id.slice(0, 8) + "….json", "success");
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-pine-600 px-2.5 py-1.5 text-[12px] font-medium text-pine-200 transition-all hover:border-chanterelle-500/60 hover:text-paper active:scale-95"
          >
            <IconDownload size={14} /> Скачать
          </button>
        </div>
      </div>
      <pre
        className="code-scroll max-h-[380px] overflow-auto px-4 py-4 font-mono text-[11.5px] leading-[1.65] text-paper sm:text-[12px]"
        dangerouslySetInnerHTML={{ __html: html }}
        aria-label="Предпросмотр JSON"
      />
    </div>
  );
}
