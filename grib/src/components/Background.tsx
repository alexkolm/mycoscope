import { useMemo, type CSSProperties } from "react";

interface SporeSpec {
  left: number;
  size: number;
  duration: number;
  delay: number;
  opacity: number;
  drift: number;
}

/** Осенний лес ночью: контуры рельефа, тёплые блики и дрейфующие споры. */
export function Background() {
  const spores = useMemo<SporeSpec[]>(
    () =>
      Array.from({ length: 16 }, (_, i) => ({
        left: (i * 61.8) % 100,
        size: 3 + ((i * 53) % 6),
        duration: 17 + ((i * 31) % 16),
        delay: -((i * 47) % 22),
        opacity: 0.14 + ((i * 29) % 26) / 100,
        drift: (i % 2 === 0 ? 1 : -1) * (24 + ((i * 41) % 56)),
      })),
    []
  );

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      {/* тёплый рыжий отсвет справа сверху, мох слева снизу */}
      <div
        className="absolute -top-40 right-[-20%] h-[60vh] w-[70vw] rounded-full"
        style={{
          background:
            "radial-gradient(closest-side, rgb(217 123 47 / 0.09), transparent 70%)",
        }}
      />
      <div
        className="absolute bottom-[-30%] left-[-15%] h-[70vh] w-[60vw] rounded-full"
        style={{
          background:
            "radial-gradient(closest-side, rgb(70 96 76 / 0.28), transparent 70%)",
        }}
      />

      {/* изолинии рельефа */}
      <svg
        className="absolute inset-0 h-full w-full opacity-[0.14]"
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
      >
        <g fill="none" stroke="#46604c" strokeWidth="1">
          <path d="M-60 130 C 220 60, 430 200, 720 150 S 1210 40, 1520 120" />
          <path d="M-60 180 C 240 110, 450 250, 740 200 S 1230 90, 1520 170" opacity=".7" />
          <path d="M-60 400 C 300 330, 520 470, 800 420 S 1250 320, 1520 400" opacity=".8" />
          <path d="M-60 450 C 320 380, 540 520, 820 470 S 1270 370, 1520 450" opacity=".5" />
          <path d="M-60 680 C 260 610, 480 750, 780 700 S 1240 600, 1520 690" opacity=".7" />
          <path d="M-60 730 C 280 660, 500 800, 800 750 S 1260 650, 1520 740" opacity=".45" />
        </g>
        <g fill="none" stroke="#7a5a3a" strokeWidth="1" opacity=".5">
          <path d="M-60 260 C 300 210, 500 330, 780 290 S 1240 200, 1520 270" />
          <path d="M-60 560 C 320 500, 560 620, 840 580 S 1260 490, 1520 560" />
        </g>
      </svg>

      {/* виньетка */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 90% at 50% 0%, transparent 55%, rgb(6 10 8 / 0.55) 100%)",
        }}
      />

      {/* дрейфующие споры */}
      {spores.map((s, i) => (
        <span
          key={i}
          className="spore"
          style={
            {
              left: `${s.left}%`,
              width: s.size,
              height: s.size,
              animationDuration: `${s.duration}s`,
              animationDelay: `${s.delay}s`,
              "--spore-o": s.opacity,
              "--spore-x": `${s.drift}px`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
