import { useMemo } from "react";

/**
 * Пузырьки/споры, поднимающиеся вверх по шапке сайта.
 * Использует готовый класс .spore и keyframe "rise" из index.css
 * (тот же приём, что и в мастхеде исходного mycoscope-проекта),
 * но с более компактным набором — подобрано под тонкую (h-16) панель.
 */
export function HeaderBubbles({ count = 12 }: { count?: number }) {
  const bubbles = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        id: i,
        left: `${(i * 53 + 7) % 100}%`,
        size: 2 + ((i * 5) % 4), // 2–5px — на тонкой панели крупнее не нужно
        delay: `${(i * 0.7) % 6}s`,
        dur: `${5 + ((i * 11) % 5)}s`,
        op: 0.35 + ((i * 9) % 5) / 10,
      })),
    [count],
  );

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {bubbles.map((b) => (
        <span
          key={b.id}
          className="spore"
          style={{
            left: b.left,
            width: b.size,
            height: b.size,
            animationDelay: b.delay,
            animationDuration: b.dur,
            opacity: b.op,
          }}
        />
      ))}
    </div>
  );
}
