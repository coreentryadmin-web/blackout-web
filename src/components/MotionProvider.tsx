"use client";

import { MotionConfig } from "framer-motion";
import { SWRConfig } from "swr";

/**
 * App-wide client providers.
 *
 * MotionConfig: every framer-motion animation respects OS prefers-reduced-motion.
 *
 * SWRConfig: global data-fetch defaults that cut background network churn (a big
 * contributor to the post-navigation "settle" lag). `revalidateOnFocus:false` stops
 * the thundering-herd refetch where EVERY mounted poller re-hits the network the
 * instant you alt-tab back — each poller keeps its own refreshInterval, so data still
 * stays fresh, and the few surfaces that truly want focus-revalidation set it
 * explicitly per-hook (e.g. IndexRibbon, GexHeatmap). `dedupingInterval` collapses
 * duplicate in-flight requests for the same key across panels.
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <SWRConfig
        value={{
          revalidateOnFocus: false,
          dedupingInterval: 3000,
          errorRetryCount: 2,
        }}
      >
        {children}
      </SWRConfig>
    </MotionConfig>
  );
}
