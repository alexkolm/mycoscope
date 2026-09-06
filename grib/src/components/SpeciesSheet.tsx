import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { SPECIES_LIST } from "../lib/observation";
import { IconCheck, IconPlus, IconX } from "./icons";

interface Props {
  open: boolean;
  onClose: () => void;
  usedIndices: Set<number>;
  /** вид текущей редактируемой строки — его можно выбрать повторно (замена) */
  editingSpeciesIndex?: number;
  onSelect: (index: number) => void;
}

export function SpeciesSheet({
  open,
  onClose,
  usedIndices,
  editingSpeciesIndex,
  onSelect,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-50 bg-black/65 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <div className="fixed inset-x-0 bottom-0 z-50 sm:inset-x-auto sm:bottom-8 sm:left-1/2 sm:w-[540px] sm:-translate-x-1/2">
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Справочник видов"
            className="max-h-[82vh] w-full overflow-hidden rounded-t-xl border border-moss-600/70 bg-moss-850 shadow-lift sm:rounded-xl"
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: "spring", damping: 26, stiffness: 320 }}
          >
            <div className="flex items-center justify-between border-b border-moss-700 px-5 py-4">
              <div>
                <h3 className="font-display text-lg text-paper">Справочник видов</h3>
                <p className="mt-0.5 text-xs text-dim">
                  фиксированный список · {SPECIES_LIST.length} видов · без
                  ядовитых
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-moss-600/60 p-2 text-fog transition-colors hover:border-rust-500/40 hover:text-paper"
                aria-label="Закрыть справочник"
              >
                <IconX size={16} />
              </button>
            </div>

            <ul className="max-h-[56vh] overflow-y-auto p-2">
              {SPECIES_LIST.map((sp, i) => {
                const used =
                  usedIndices.has(i) && i !== editingSpeciesIndex;
                return (
                  <li key={sp.common_name_ru}>
                    <button
                      type="button"
                      disabled={used}
                      onClick={() => onSelect(i)}
                      className={`flex w-full items-center gap-3.5 rounded-lg px-3.5 py-3 text-left transition-all ${
                        used
                          ? "cursor-not-allowed opacity-35"
                          : "hover:bg-moss-700/70 active:scale-[0.99]"
                      }`}
                    >
                      <span className="w-7 shrink-0 font-mono text-xs text-rust-400/90">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px] font-semibold text-paper">
                          {sp.common_name_ru}
                        </span>
                        <span className="block truncate text-xs italic text-dim">
                          {Array.isArray(sp.scientific_name)
                            ? sp.scientific_name.join("; ")
                            : sp.scientific_name}
                        </span>
                      </span>
                      {used ? (
                        <span className="flex items-center gap-1 text-xs text-lichen">
                          <IconCheck size={14} /> в анкете
                        </span>
                      ) : (
                        <span className="rounded-md border border-rust-500/40 p-1.5 text-rust-400">
                          <IconPlus size={14} />
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>

            <p className="border-t border-moss-700 px-5 py-3 text-[11.5px] leading-relaxed text-dim">
              Добавлять новые виды, удалять или переименовывать существующие в
              MVP нельзя — справочник фиксирован. Один вид нельзя добавить в
              анкету дважды.
            </p>
          </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
