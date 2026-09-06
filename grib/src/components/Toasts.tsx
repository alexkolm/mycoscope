import { AnimatePresence, motion } from "framer-motion";
import { IconAlert, IconCheck, IconInfo, IconX } from "./icons";

export interface ToastItem {
  id: number;
  text: string;
  tone: "info" | "error" | "success";
}

const TONE = {
  info: { border: "border-amberish/40", icon: "text-amberish" },
  error: { border: "border-emberred/50", icon: "text-emberred" },
  success: { border: "border-lichen/50", icon: "text-lichen" },
} as const;

export function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[70] flex flex-col items-center gap-2 px-4">
      <AnimatePresence>
        {toasts.map((t) => {
          const tone = TONE[t.tone];
          return (
            <motion.div
              key={t.id}
              layout
              role="status"
              initial={{ opacity: 0, y: -18, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12, scale: 0.97 }}
              transition={{ type: "spring", damping: 24, stiffness: 380 }}
              className={`pointer-events-auto flex w-full max-w-lg items-start gap-2.5 rounded-lg border ${tone.border} bg-moss-850/95 px-3.5 py-3 shadow-lift backdrop-blur-md`}
            >
              <span className={`mt-0.5 shrink-0 ${tone.icon}`}>
                {t.tone === "error" ? (
                  <IconAlert size={16} />
                ) : t.tone === "success" ? (
                  <IconCheck size={16} />
                ) : (
                  <IconInfo size={16} />
                )}
              </span>
              <p className="flex-1 text-[13px] leading-snug text-paper">{t.text}</p>
              <button
                type="button"
                onClick={() => onDismiss(t.id)}
                className="shrink-0 rounded p-1 text-dim transition-colors hover:text-paper"
                aria-label="Закрыть уведомление"
              >
                <IconX size={13} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
