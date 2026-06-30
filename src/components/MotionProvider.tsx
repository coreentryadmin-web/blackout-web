"use client";

import { MotionConfig } from "framer-motion";
import { SWRConfig } from "swr";

/**
 * App-wide client providers.
 *
 * MotionConfig: every framer-motion animation respects OS prefers-reduced-motion.
 *
 * SWRConfig: global data-fetch defaults tuned for ALWAYS-LIVE data.
 *  - `revalidateOnFocus: true` — the instant you return to the tab, every surface
 *    refreshes (SWR pauses refreshInterval while a tab is hidden, so this is what
 *    makes data feel live again immediately on return — no manual refresh, ever).
 *  - `dedupingInterval: 3000` — collapses duplicate in-flight requests for the same
 *    key across panels, so the on-focus refresh can't become a thundering herd.
 *  - `errorRetryCount: 2` — bounded retries.
 * Per-component `refreshInterval`s drive continuous live updates while viewing; this
 * config guarantees freshness on tab re-entry too.
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <SWRConfig
        value={{
          revalidateOnFocus: true,
          dedupingInterval: 3000,
          errorRetryCount: 2,
        }}
      >
        {children}
      </SWRConfig>
    </MotionConfig>
  );
}
