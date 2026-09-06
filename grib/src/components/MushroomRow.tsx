import type { ReactNode } from "react";
import { motion } from "framer-motion";
import type { Abundance, Maturity, RowState, WormDamage } from "../lib/types";
import { SPECIES_LIST } from "../lib/observation";
import { Segmented } from "./Segmented";
import { IconAlert, IconSwap, IconTrash } from "./icons";

export const ABUNDANCE_LABELS: Record<Abundance, string> = {
  1: "единичные",
  2: "мало",
  3: "средне",
  4: "много",
  5: "очень много",
};

const MATURITY_OPTIONS: { value: Maturity; label: string }[] = [
  { value: "fresh", label: "Свежие" },
  { value: "mostly_fresh", label: "Преимущественно свежие" },
  { value: "mostly_old", label: "Преимущественно старые" },
  { value: "mixed", label: "Смешанные" },
];

const WORM_OPTIONS: { value: WormDamage; label: string }[] = [
  { value: 0, label: "Нет" },
  { value: 1, label: "Слабая" },
  { value: 2, label: "Средняя" },
  { value: 3, label: "Сильная" },
];

function FieldLabel({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-dim">
        {children}
      </span>
      {aside}
    </div>
  );
}

interface Props {
  row: RowState;
  index: number;
  error?: string;
  onPatch: (patch: Partial<RowState>) => void;
  onRemove: () => void;
  onChangeSpecies: () => void;
}

export function MushroomRow({ row, index, error, onPatch, onRemove, onChangeSpecies }: Props) {
  const sp = SPECIES_LIST[row.speciesIndex];
  const absent = row.status === "absent";
  const scientific = sp
    ? Array.isArray(sp.scientific_name)
      ? sp.scientific_name.join("; ")
      : sp.scientific_name
    : "";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 18, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: -36, transition: { duration: 0.18 } }}
      transition={{ type: "spring", damping: 26, stiffness: 320 }}
      className={`rounded-lg border bg-moss-900/80 p-4 shadow-lift sm:p-5 ${
        error ? "border-emberred/50" : "border-moss-600/60"
      }`}
    >
      {/* шапка строки: вид + удалить */}
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-rust-500/25 bg-rust-500/12 font-mono text-[13px] font-bold text-rust-400">
          {String(index + 1).padStart(2, "0")}
        </span>
        <button
          type="button"
          onClick={onChangeSpecies}
          className="group -mx-2 min-w-0 flex-1 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-moss-700/50"
        >
          <span className="flex items-center gap-2 text-[15.5px] font-bold leading-tight text-paper">
            <span className="truncate">{sp ? sp.common_name_ru : "Выбрать вид"}</span>
            <IconSwap
              size={14}
              className="shrink-0 text-dim transition-colors group-hover:text-rust-400"
            />
          </span>
          {sp && (
            <span className="block truncate text-xs italic text-dim">{scientific}</span>
          )}
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 rounded-md border border-moss-600/60 p-2.5 text-dim transition-all hover:border-emberred/40 hover:text-emberred active:scale-95"
          aria-label={`Удалить строку ${sp?.common_name_ru ?? index + 1}`}
        >
          <IconTrash size={16} />
        </button>
      </div>

      {error && (
        <p className="mt-2 flex items-center gap-1.5 text-[12.5px] font-medium text-emberred">
          <IconAlert size={13} /> {error}
        </p>
      )}

      <div className="mt-4 grid gap-4">
        {/* урожай */}
        <div>
          <FieldLabel>Текущий урожай</FieldLabel>
          <Segmented
            ariaLabel="Текущий урожай"
            options={[
              { value: "present", label: "Есть" },
              { value: "absent", label: "Нет" },
            ]}
            value={row.status}
            onChange={(v) => onPatch({ status: v })}
            cols="grid-cols-2"
          />
          {absent && (
            <p className="mt-2 rounded-md border border-amberish/25 bg-amberish/8 px-3 py-2 text-[12.5px] leading-snug text-amberish">
              Вид подтверждён для точки, но урожая сейчас нет. Количество,
              состояние и червивость не заполняются — в JSON уйдёт{" "}
              <span className="font-mono text-[11.5px]">status: "absent"</span>.
            </p>
          )}
        </div>

        {/* количество */}
        <div>
          <FieldLabel
            aside={
              !absent && (
                <span className="font-mono text-[11.5px] text-rust-300">
                  {row.abundance} · {ABUNDANCE_LABELS[row.abundance]}
                </span>
              )
            }
          >
            Количество
          </FieldLabel>
          <Segmented
            ariaLabel="Количество"
            options={[1, 2, 3, 4, 5].map((n) => ({
              value: n as Abundance,
              label: String(n),
            }))}
            value={row.abundance}
            onChange={(v) => onPatch({ abundance: v })}
            disabled={absent}
            cols="grid-cols-5"
          />
        </div>

        {/* состояние */}
        <div>
          <FieldLabel>Общее состояние</FieldLabel>
          <Segmented
            ariaLabel="Общее состояние"
            options={MATURITY_OPTIONS}
            value={row.maturity}
            onChange={(v) => onPatch({ maturity: v })}
            disabled={absent}
            cols="grid-cols-2 sm:grid-cols-4"
          />
        </div>

        {/* червивость */}
        <div>
          <FieldLabel>Червивость</FieldLabel>
          <Segmented
            ariaLabel="Червивость"
            options={WORM_OPTIONS}
            value={row.wormDamage}
            onChange={(v) => onPatch({ wormDamage: v })}
            disabled={absent}
            cols="grid-cols-2 sm:grid-cols-4"
          />
        </div>

        {/* комментарий по виду */}
        <div>
          <FieldLabel
            aside={
              <span className="font-mono text-[10.5px] text-dim">
                {row.comment.length}/500
              </span>
            }
          >
            Комментарий по виду
          </FieldLabel>
          <textarea
            value={row.comment}
            maxLength={500}
            onChange={(e) => onPatch({ comment: e.target.value })}
            rows={2}
            placeholder="Например: в основном крупные перестоялые и червивые, немного молодых свежих…"
            className="w-full resize-y rounded-md border border-moss-600/60 bg-moss-800/70 px-3.5 py-2.5 text-[14px] leading-relaxed text-ink placeholder:text-ink-soft/70 transition-colors focus:border-rust-500/60"
          />
        </div>
      </div>
    </motion.div>
  );
}
