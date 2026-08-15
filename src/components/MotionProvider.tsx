"use client";

import { MotionConfig } from "framer-motion";
import { SWRConfig } from "swr";

/**
 * App-wide client providers.
 *
 * MotionConfig: every framer-motion animation respects OS prefers-reduced-motion.
 * Default transition is snappy (180ms) — premium desks should feel instant, not floaty.
 *
 * SWRConfig: global data-fetch defaults tuned for live desks WITHOUT tab-focus storms.
 *  - `revalidateOnFocus: false` — returning to a tab used to refetch every mounted SWR
 *    hook at once (Thermal matrix, SPX pulse, Vector universe, etc.) and freeze the UI.
 *    Per-hook `refreshInterval` keeps data live while viewing; hooks that truly need a
 *    focus refresh opt in explicitly.
 *  - `dedupingInterval: 5000` — collapse duplicate in-flight keys across panels.
 *  - `errorRetryCount: 2` — bounded retries.
 */
const PREMIUM_MOTION = { duration: 0.18, ease: [0.22, 1, 0.36, 1] as const };

export function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={PREMIUM_MOTION}>
      <SWRConfig
        value={{
          revalidateOnFocus: false,
          revalidateOnReconnect: true,
          dedupingInterval: 5000,
          errorRetryCount: 2,
        }}
      >
        {children}
      </SWRConfig>
    </MotionConfig>
  );
}
