import type { ReactNode } from "react";

interface Option<T> {
  value: T;
  label: ReactNode;
}

interface Props<T extends string | number> {
  options: Option<T>[];
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
  cols?: string;
  ariaLabel?: string;
}

/** Крупные «полевые» переключатели: легко попадать пальцем на ходу. */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  disabled = false,
  cols = "grid-cols-2",
  ariaLabel,
}: Props<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={`grid ${cols} gap-1.5 ${
        disabled ? "pointer-events-none opacity-35 saturate-50" : ""
      }`}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            tabIndex={disabled ? -1 : 0}
            onClick={() => onChange(opt.value)}
            className={`h-11 select-none rounded-md border px-2 text-[13.5px] leading-tight transition-all duration-150 sm:text-sm ${
              active
                ? "border-rust-400/60 bg-rust-500 font-semibold text-[#1c1207] shadow-glow-rust active:scale-[0.97]"
                : "border-moss-600/60 bg-moss-800/70 text-ink-soft hover:border-rust-500/40 hover:bg-moss-700/70 hover:text-ink active:scale-[0.97]"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
