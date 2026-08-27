"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { formatVectorAge } from "@/features/vector/lib/vector-age-format";

type Props = {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  /** Server-side fetch time of the dark-pool snapshot currently rendered — the cache's own
   *  `fetchedAt`, which can be up to 25 minutes old by design (tolerating one missed cron run) and
   *  arbitrarily older during a sustained upstream outage (a failed fetch skips the write, so the
   *  same stale snapshot keeps serving). Rendering age here mirrors the GEX/VEX lens age chip
   *  (VectorLensToggle) — this field previously reached the client but was never surfaced anywhere,
   *  so a 20+ minute-stale dark-pool print rendered with no visual difference from a live one. */
  darkPoolAsOf?: number | null;
  liveSession?: boolean;
  /** When false, omit data-testid (compact toolbar row duplicates desktop controls in DOM). */
  exposeTestIds?: boolean;
};

/** Opt-in dark-pool concentration levels on the price pane (orange dashed guides). */
export function VectorDarkPoolToggle({
  enabled,
  onChange,
  darkPoolAsOf,
  liveSession = false,
  exposeTestIds = true,
}: Props) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (!liveSession) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [liveSession]);

  const age = formatVectorAge(darkPoolAsOf, now);

  return (
    <div className="vector-desk-seg vector-dp-walls-seg" role="group" aria-label="Dark pool walls">
      <button
        type="button"
        aria-pressed={enabled}
        title="Show top institutional dark-pool price levels as orange dashed guides on the chart."
        onClick={() => onChange(!enabled)}
        {...(exposeTestIds ? { "data-testid": "vector-dp-walls-toggle" } : {})}
        className={clsx("vector-desk-seg-btn", enabled && "is-active is-dp-walls")}
      >
        DP
        {liveSession && age != null ? <span className="vector-desk-seg-meta">· {age}</span> : null}
      </button>
    </div>
  );
}
