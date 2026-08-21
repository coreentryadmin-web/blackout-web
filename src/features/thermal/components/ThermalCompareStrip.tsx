"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { clsx } from "clsx";
import { usePollIntervalMs } from "@/hooks/use-et-market-open";
// Canonical cash-RTH gate — holiday- and early-close-aware, documented safe on the client.
import { isEtCashRth } from "@/lib/et-market-hours";

/** ONE source for the compare poll cadence, so the label and the actual interval cannot drift. */
const COMPARE_POLL_MS = 5_000;
import {
  THERMAL_COMPARE_TICKERS,
  type ThermalCompareTicker,
  thermalCompareStripLabel,
} from "@/features/thermal/lib/thermal-desk-state";

type ComparePayload = {
  available: boolean;
  underlying?: string;
  spot?: number;
  change_pct?: number;
  asof?: string;
  gex?: {
    call_wall?: number | null;
    put_wall?: number | null;
    flip?: number | null;
    total?: number | null;
  };
};

async function fetchCompare(url: string): Promise<ComparePayload> {
  const res = await fetch(url, { credentials: "same-origin", cache: "no-store" });
  if (!res.ok) throw new Error(`heatmap ${res.status}`);
  return res.json();
}

function fmtPx(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function CompareCard({
  ticker,
  active,
  onPick,
}: {
  ticker: ThermalCompareTicker;
  active: boolean;
  onPick: (t: ThermalCompareTicker) => void;
}) {
  const pollMs = usePollIntervalMs(COMPARE_POLL_MS, COMPARE_POLL_MS);
  const { data, isLoading } = useSWR<ComparePayload>(
    `/api/market/gex-heatmap?ticker=${ticker}`,
    fetchCompare,
    { refreshInterval: pollMs, revalidateOnFocus: false, keepPreviousData: true }
  );

  const spot = data?.spot ?? null;
  const chg = data?.change_pct ?? null;
  const call = data?.gex?.call_wall ?? null;
  const put = data?.gex?.put_wall ?? null;
  const flip = data?.gex?.flip ?? null;
  const up = chg != null && chg >= 0;

  return (
    <button
      type="button"
      onClick={() => onPick(ticker)}
      aria-pressed={active}
      // Rich a11y label — before this a screen reader only heard "SPY compare
      // card, selected" with none of the numbers that make the card meaningful.
      // Now the full spot + call/put/flip context is spoken on focus.
      aria-label={[
        `${ticker}`,
        spot != null ? `spot ${fmtPx(spot)}` : "spot unavailable",
        chg != null ? `${chg >= 0 ? "up" : "down"} ${Math.abs(chg).toFixed(2)} percent` : null,
        call != null ? `call wall ${fmtPx(call, 0)}` : null,
        put != null ? `put wall ${fmtPx(put, 0)}` : null,
        flip != null ? `gamma flip ${fmtPx(flip, ticker === "SPX" ? 1 : 2)}` : null,
        active ? "selected" : "click to select",
      ]
        .filter(Boolean)
        .join(", ")}
      // Fixed min-h prevents the ~62→90px layout jump between "…" skeleton state
      // and the loaded card — cards used to grow AFTER the SWR resolved, shoving
      // everything below them down on every ticker switch.
      // `motion-safe:` prefix on the press scale — the AlertsStrip fix (this
      // PR, round 1) already established "any always-visible transform gets
      // motion-safe:". Keeps `prefers-reduced-motion` users still.
      className={clsx(
        "min-w-0 flex-1 min-h-[92px] rounded-xl border px-3 py-2.5 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60",
        "motion-safe:active:scale-[0.99]",
        active
          ? "border-cyan-400/50 bg-cyan-400/[0.08]"
          : "border-white/12 bg-[rgba(8,9,14,0.55)] hover:border-sky-300/35"
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-white">
          {ticker}
        </span>
        {chg != null && Number.isFinite(chg) ? (
          <span
            className={clsx(
              "font-mono text-[10px] font-semibold tabular-nums",
              up ? "text-bull" : "text-bear-text"
            )}
          >
            {up ? "+" : ""}
            {chg.toFixed(2)}%
          </span>
        ) : (
          <span className="font-mono text-[10px] text-sky-300/70">
            {isLoading ? "…" : "—"}
          </span>
        )}
      </div>
      <div className="mt-1 font-mono text-[18px] font-bold tabular-nums text-white leading-none">
        {/* Was `fmtPx(spot, ticker === "SPX" ? 2 : 2)` — dead ternary (both
            branches identical). Cleaned to a single argument. SPX spot precision
            deliberately stays at 2dp to line up with SPY/QQQ in the row. */}
        {fmtPx(spot, 2)}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1.5 font-mono text-[9px] uppercase tracking-[0.12em]">
        <div>
          <div className="text-sky-300/70">Call</div>
          <div className="text-[12px] font-semibold tabular-nums text-bull normal-case tracking-normal">
            {fmtPx(call, 0)}
          </div>
        </div>
        <div>
          <div className="text-sky-300/70">Put</div>
          <div className="text-[12px] font-semibold tabular-nums text-bear-text normal-case tracking-normal">
            {fmtPx(put, 0)}
          </div>
        </div>
        <div>
          <div className="text-sky-300/70">Flip</div>
          <div
            className="text-[12px] font-semibold tabular-nums text-sky-300 normal-case tracking-normal"
            title={flip == null ? "Gamma flip undetermined" : undefined}
          >
            {fmtPx(flip, ticker === "SPX" ? 1 : 2)}
          </div>
        </div>
      </div>
    </button>
  );
}

/**
 * SPY / SPX / QQQ live compare strip — three cache-reader cards on the shared
 * heatmap endpoint. Click selects the desk ticker. Never fabricates walls/flip.
 */
export function ThermalCompareStrip({
  activeTicker,
  onPick,
  className,
}: {
  activeTicker: string;
  onPick: (ticker: string) => void;
  className?: string;
}) {
  const active = activeTicker.toUpperCase();

  // Resolved on the CLIENT, null until then — deriving it during render would put the server's ET
  // and the browser's ET in one HTML payload. Deliberately NOT `useEtMarketOpen()`, which seeds
  // `useState(true)`: defaulting to OPEN is harmless for a poll interval but is exactly wrong for
  // a liveness CLAIM, which must never assert live before it knows. See thermalQuoteBadge.
  const [marketOpenNow, setMarketOpenNow] = useState<boolean | null>(null);
  useEffect(() => {
    const tick = () => setMarketOpenNow(isEtCashRth(new Date()));
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);
  const stripLabel = thermalCompareStripLabel({
    marketOpen: marketOpenNow,
    pollSeconds: COMPARE_POLL_MS / 1000,
  });

  return (
    <div
      className={clsx("gex-compare-strip", className)}
      role="group"
      aria-label="Compare SPY SPX QQQ"
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-sky-300/80">
          Compare · SPY / SPX / QQQ
        </span>
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-cyan-400/80">
          {stripLabel}
        </span>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        {THERMAL_COMPARE_TICKERS.map((t) => (
          <CompareCard
            key={t}
            ticker={t}
            active={active === t}
            onPick={(picked) => onPick(picked)}
          />
        ))}
      </div>
    </div>
  );
}
