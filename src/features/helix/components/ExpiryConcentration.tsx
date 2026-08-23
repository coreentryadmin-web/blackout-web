"use client";

import { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { fmtPremium, type FlowAlert } from "@/lib/api";
import { daysToExpiry } from "@/features/helix/lib/helix-flow-format";
import {
  horizonDirection,
  horizonDirectionTitle,
  horizonTone,
  type HorizonDirection,
} from "@/features/helix/lib/helix-expiry-horizon";
import { Panel } from "@/components/ui";

type Bucket = {
  label: string;
  /** Native call/put premium — kept because it is this panel's own fact, and the product contract
   *  is additive. It no longer decides the colour; see `direction`. */
  callPremium: number;
  putPremium: number;
  total: number;
  count: number;
  /** Aggression-aware verdict plus the share of premium it could actually be read from. */
  direction: HorizonDirection;
};

/**
 * Horizon bucket for a print, matching `expiryHorizonLabel` in
 * `src/lib/largo/helix-tape-analytics.ts` exactly — the two describe the same panel to two
 * audiences and must not disagree about it.
 *
 * `dte <= 0`, not `dte === 0`. The tape's `dte` comes from SQL as
 * `expiry - (NOW() AT TIME ZONE 'America/New_York')::date` and is genuinely NEGATIVE for a print
 * on an already-expired contract — routine here, because the tape's default window is 7 days of
 * history. An exact `=== 0` test misses those, so they fell through to the `dte <= 7` branch and
 * were filed under **"This week"** — a FUTURE horizon, for a contract that has already expired.
 *
 * MEASURED (live prod tape, 5000 rows, 2026-08-22 — docs/audit/HELIX-MAP.md §9.5): **803 rows,
 * 16.1%** carry a negative DTE. Not an edge case; a sixth of the panel.
 *
 * Largo's copy was fixed when the defect was found and its comment named this panel as the
 * remaining half. This closes it, so both surfaces bucket identically.
 */
export function bucketLabel(dte: number): string {
  if (dte <= 0) return "0DTE";
  if (dte <= 7) return "This week";
  if (dte <= 30) return "Monthly";
  return "LEAPS";
}

/**
 * The premium the widest bar represents.
 *
 * MUST be the largest bucket, not the first one. `buckets` is built in CHRONOLOGICAL order
 * (`["0DTE", "This week", "Monthly", "LEAPS"]`), so `buckets[0]` is simply the nearest-dated
 * bucket that survived the $50k floor — it is the biggest only by coincidence.
 *
 * Reading the max off `buckets[0]` meant every bucket bigger than the first computed a width over
 * 100%, and the rail is `overflow-hidden`, so they all clipped to FULL WIDTH and became visually
 * identical. With 0DTE $1M / This week $3M / Monthly $5M the three bars rendered the same length
 * while the labels beside them read 11% / 33% / 56% — the chart said "equal", the numbers said 5x.
 * A bar chart that saturates exactly when one horizon starts dominating is worse than no bar at
 * all, because the dominance is the whole thing a member is looking for here.
 */
export function bucketMaxTotal(buckets: readonly { total: number }[]): number {
  let max = 0;
  for (const b of buckets) {
    if (Number.isFinite(b.total) && b.total > max) max = b.total;
  }
  return max > 0 ? max : 1; // never divide by zero; an all-empty set renders at the floor width
}

/** Bar width as a % of the rail, floored so a tiny-but-present bucket is still visible. */
export function barWidthPct(total: number, maxTotal: number): number {
  if (!Number.isFinite(total) || !Number.isFinite(maxTotal) || maxTotal <= 0) return MIN_BAR_PCT;
  const pct = (total / maxTotal) * 100;
  if (!Number.isFinite(pct)) return MIN_BAR_PCT;
  // Clamped at both ends: the floor keeps a small bucket visible, and the ceiling means a future
  // change to how maxTotal is derived can never again silently push a bar past its container.
  return Math.min(100, Math.max(MIN_BAR_PCT, pct));
}

const MIN_BAR_PCT = 8;

export function ExpiryConcentration({ alerts, loading }: { alerts: FlowAlert[]; loading: boolean }) {
  const buckets = useMemo(() => {
    if (!alerts.length) return [];
    const map = new Map<
      string,
      { callPremium: number; putPremium: number; count: number; flows: FlowAlert[] }
    >();

    for (const a of alerts) {
      const dte = a.dte ?? daysToExpiry(a.expiry);
      const label = bucketLabel(dte);
      const cur = map.get(label) ?? { callPremium: 0, putPremium: 0, count: 0, flows: [] };
      if (a.option_type === "CALL") cur.callPremium += a.premium;
      else if (a.option_type === "PUT") cur.putPremium += a.premium;
      cur.count++;
      cur.flows.push(a);
      map.set(label, cur);
    }

    const order = ["0DTE", "This week", "Monthly", "LEAPS"];
    return order
      .filter((l) => map.has(l))
      .map((label) => {
        const { callPremium, putPremium, count, flows } = map.get(label)!;
        const total = callPremium + putPremium;
        return {
          label,
          callPremium,
          putPremium,
          total,
          count,
          direction: horizonDirection(flows),
        } as Bucket;
      })
      .filter((b) => b.total >= 50_000);
  }, [alerts]);

  if (loading || buckets.length === 0) return null;

  const maxTotal = bucketMaxTotal(buckets);
  const grandTotal = buckets.reduce((s, b) => s + b.total, 0);

  return (
    <Panel accent="purple" kicker="⟐ expiry horizon" title="Expiry Concentration" bodyClassName="space-y-2">
      <AnimatePresence initial={false}>
        {buckets.map((b, i) => {
          const pct = grandTotal > 0 ? Math.round((b.total / grandTotal) * 100) : 0;
          const barW = barWidthPct(b.total, maxTotal);
          // Colour comes from the aggression-aware read, not from call-vs-put premium: a SOLD call
          // is bearish, and by the old rule every one of the four horizons rendered green while
          // disagreeing with the rule the rest of this page already uses.
          const tone = horizonTone(b.direction);
          const isBull = tone === "bull";
          const isBear = tone === "bear";
          const dirTitle = horizonDirectionTitle(b.direction);
          return (
            <motion.div
              key={b.label}
              layout="position"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              transition={{ delay: i * 0.04, duration: 0.25 }}
              className="space-y-1"
              title={dirTitle}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[12px] font-bold text-purple-200 w-20">{b.label}</span>
                  <span className="font-mono text-[10px] tabular-nums text-sky-300/60">{b.count} prints</span>
                  {/* A neutral bar and an UNREADABLE one look identical, and the second is the
                      common case here: the index feed carries no ask side, so 94% of Monthly and
                      97% of LEAPS premium has no readable direction. Saying so is the difference
                      between "balanced" and "we cannot tell". */}
                  {b.direction.minorityEvidence && b.direction.readablePct != null && (
                    <span className="font-mono text-[9px] tabular-nums text-amber-300/70">
                      direction unread · {Math.round(b.direction.readablePct)}% sided
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] font-semibold tabular-nums text-purple-300/80">{pct}%</span>
                  <span
                    className="font-mono text-[12px] font-bold tabular-nums"
                    style={{ color: isBull ? "#a3e635" : isBear ? "#ff2d55" : "#c4b5fd" }}
                  >
                    {fmtPremium(b.total)}
                  </span>
                </div>
              </div>
              <div className="relative h-2 rounded-full overflow-hidden bg-white/[0.06]">
                <motion.div
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{
                    background: isBull
                      ? "linear-gradient(90deg, #00b35a, #a3e635)"
                      : isBear
                        ? "linear-gradient(90deg, #b3203c, #ff2d55)"
                        : "linear-gradient(90deg, #7c3aed, #a78bfa)",
                    width: `${barW}%`,
                  }}
                  initial={{ width: 0 }}
                  animate={{ width: `${barW}%` }}
                  transition={{ duration: 0.7, ease: [0.34, 1.56, 0.64, 1], delay: i * 0.04 }}
                />
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
      <p className="font-mono text-[10px] text-sky-300/70 text-center pt-1">
        Premium by expiry horizon · call/put colored
      </p>
    </Panel>
  );
}
