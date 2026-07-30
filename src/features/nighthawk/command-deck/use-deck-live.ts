"use client";

import { useEffect, useRef, useState } from "react";

/** 1 Hz clock — drives mark-age labels, time-stop, and 1s management refresh. */
export function useSecondTick(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** Neon flash when a live value changes (skip first paint). */
export function useFlash(value: unknown): boolean {
  const prev = useRef<unknown>(undefined);
  const primed = useRef(false);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (!primed.current) {
      primed.current = true;
      prev.current = value;
      return;
    }
    if (prev.current !== value) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 280);
      prev.current = value;
      return () => clearTimeout(t);
    }
  }, [value]);
  return flash;
}
