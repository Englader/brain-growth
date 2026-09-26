/** rAF hop animation: position eases linearly, height follows a parabola. */
export interface HopFrame {
  pos: number;
  lift: number;
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Animate a sequence of hops. Returns a cancel function.
 * `onHop` fires as each hop lands (sound, counters).
 */
export function animateHops(
  hops: ReadonlyArray<{ from: number; to: number }>,
  onFrame: (f: HopFrame) => void,
  opts: { msPerHop?: number; height?: number; onHop?: (i: number) => void; onDone?: () => void } = {},
): () => void {
  const reduce = prefersReducedMotion();
  let cancelled = false;
  let raf = 0;
  const run = (i: number): void => {
    if (cancelled) return;
    if (i >= hops.length) {
      opts.onDone?.();
      return;
    }
    const h = hops[i]!;
    if (reduce) {
      onFrame({ pos: h.to, lift: 0 });
      opts.onHop?.(i);
      window.setTimeout(() => run(i + 1), 60);
      return;
    }
    const dur = opts.msPerHop ?? 360;
    const height = opts.height ?? 34;
    const t0 = performance.now();
    const step = (now: number): void => {
      if (cancelled) return;
      const t = Math.min(1, (now - t0) / dur);
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      onFrame({ pos: h.from + (h.to - h.from) * e, lift: Math.sin(Math.PI * t) * height });
      if (t < 1) raf = requestAnimationFrame(step);
      else {
        opts.onHop?.(i);
        run(i + 1);
      }
    };
    raf = requestAnimationFrame(step);
  };
  run(0);
  return () => {
    cancelled = true;
    cancelAnimationFrame(raf);
  };
}

/** Split long unit-step hops into single hops so a pre-reader can count them. */
export function unitHops(hops: ReadonlyArray<{ from: number; to: number }>, maxUnits = 12): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = [];
  for (const h of hops) {
    const d = h.to - h.from;
    if (Math.abs(d) > 1 && Math.abs(d) <= maxUnits && Number.isInteger(d)) {
      const s = Math.sign(d);
      for (let k = 0; k < Math.abs(d); k++) out.push({ from: h.from + k * s, to: h.from + (k + 1) * s });
    } else out.push(h);
  }
  return out;
}
