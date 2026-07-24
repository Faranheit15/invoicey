"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Animate a number from its previous value to `target` with an ease-out curve.
 * When `enabled` is false (reduced motion), it jumps straight to the target.
 */
export function useCountUp(
  target: number,
  { duration = 800, enabled = true }: { duration?: number; enabled?: boolean } = {}
): number {
  const [value, setValue] = useState(enabled ? 0 : target);
  const fromRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setValue(target);
      fromRef.current = target;
      return;
    }
    let raf = 0;
    const start = performance.now();
    const from = fromRef.current;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(from + (target - from) * eased);
      if (t < 1) {
        raf = requestAnimationFrame(step);
      } else {
        fromRef.current = target;
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, enabled]);

  return value;
}
