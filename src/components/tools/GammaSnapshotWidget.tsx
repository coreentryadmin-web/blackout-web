"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { publicFreshnessCopy } from "@/lib/public-gex-snapshot-types";
import type { PublicGexSnapshot, PublicGexTicker } from "@/lib/public-gex-snapshot";

const TICKERS: PublicGexTicker[] = ["SPX", "SPY", "QQQ"];

/**
 * The honest one-word claim under a wall tile.
 *
 * A wall is defined by the SIGN of dealer gamma, not by its side of spot, so it can legitimately
 * land on the wrong side — SPX was live at spot 7,748.5 with its put wall at 8,000 on 2026-08-12.
 * The number is right; calling it "support" 250 points overhead is not. When the wall is on the
 * wrong side this says CONCENTRATION instead, matching the Thermal Key Levels tile (#2115).
 *
 * Treated as optional-at-runtime on purpose: the snapshot is Redis-cached, so entries written by
 * the PREVIOUS deploy carry no role field and arrive as `undefined`. Rendering nothing in that
 * window is correct — it degrades to the plain label rather than asserting a side we were not told.
 */
function WallRole({ role, kind }: { role: PublicGexSnapshot["call_wall_role"]; kind: "call" | "put" }) {
  if (!role) {
    return <p className="font-mono text-[9px] text-transparent uppercase tracking-wider mt-0.5 h-3">—</p>;
  }
  if (role === "concentration") {
    return (
      <p
        className="font-mono text-[9px] text-amber-300/70 uppercase tracking-wider mt-0.5"
        title={`This strike carries the most ${kind} dealer gamma, but it currently sits on the far side of spot — a gamma concentration, not a ${kind === "call" ? "resistance" : "support"} level.`}
      >
        concentration
      </p>
    );
  }
  return <p className="font-mono text-[9px] text-sky-300/45 uppercase tracking-wider mt-0.5">{role}</p>;
}

function fmtLevel(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/**
 * The freshness line, split into what it can honestly claim.
 *
 * This used to be `fmtAge(asof)` rendered as "Updated {age}". `asof` is the MATRIX COMPUTE time,
 * not the price's — on a closed market the builder recomputes every few seconds over an unchanged
 * book, so it read "Updated just now" beside a spot that had not moved since the last bell.
 * Measured on production 2026-08-22 19:15 ET (Saturday): SPX 7674.37 and SPY 765.72 were Friday's
 * closes to the cent, stamped under 20 seconds old, with no session label on the page.
 *
 * `publicFreshnessCopy` lives in the client-safe types module so the wording is unit-tested; this
 * component only places it.
 */

export function GammaSnapshotWidget({ initial }: { initial: PublicGexSnapshot }) {
  const [ticker, setTicker] = useState<PublicGexTicker>(initial.ticker as PublicGexTicker);
  const [snapshot, setSnapshot] = useState<PublicGexSnapshot>(initial);
  const [loading, setLoading] = useState(false);

  // Guards a slow response for ticker A from overwriting a newer one for ticker B. Without it a
  // 5s poll racing a ticker click can repaint SPX numbers under a QQQ heading — the one way a
  // faster refresh can make a levels widget LESS correct than a static one.
  const wantedTicker = useRef(ticker);

  const load = useCallback(async (next: PublicGexTicker, showSpinner: boolean) => {
    wantedTicker.current = next;
    if (showSpinner) setLoading(true);
    try {
      const res = await fetch(`/api/public/gex-snapshot?ticker=${next}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as PublicGexSnapshot;
      if (wantedTicker.current === next) setSnapshot(data);
    } catch {
      /* keep showing the last good snapshot */
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, []);

  /**
   * Live refresh, matched to the server lane.
   *
   * The underlying matrix (fetchGexHeatmap, the same one Thermal reads) turns over every ~5s and
   * the public snapshot's own cache is now 5s too, so 5s here is the fastest cadence that can
   * actually show new numbers rather than re-fetching identical bytes.
   *
   * Gated on visibility for two reasons: a backgrounded tab left open overnight would otherwise
   * poll ~17k times by morning for a market that is closed, and browsers throttle timers in hidden
   * tabs anyway, so the requests that DID fire would land in unpredictable bursts. Refetching
   * immediately on re-show is the part that matters to a user — coming back to the tab should
   * repaint current levels, not whatever was on screen when they left.
   */
  useEffect(() => {
    if (typeof document === "undefined") return;
    let timer: number | undefined;
    const tick = () => {
      if (document.visibilityState === "visible") void load(ticker, false);
    };
    const start = () => {
      window.clearInterval(timer);
      timer = window.setInterval(tick, 5_000);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        tick(); // repaint on return before waiting out a full interval
        start();
      } else {
        window.clearInterval(timer);
      }
    };
    // Fetch once on mount: the SSR seed was rendered server-side and is already a few seconds old
    // before it reaches the browser.
    tick();
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load, ticker]);

  async function selectTicker(next: PublicGexTicker) {
    if (next === ticker) return;
    setTicker(next);
    await load(next, true);
  }

  // Recomputed on every render (the 5s poll re-renders), so the age phrase tracks the clock.
  const freshness = publicFreshnessCopy({
    asof: snapshot.asof,
    market_session: snapshot.market_session,
  });

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-[#050608]/60 backdrop-blur-md p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex gap-1.5">
          {TICKERS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => selectTicker(t)}
              className={
                "rounded-lg px-3 py-1.5 font-mono text-xs font-semibold uppercase tracking-wide transition " +
                (t === ticker
                  ? "bg-cyan-400 text-black"
                  : "border border-white/15 text-white/60 hover:border-white/30 hover:text-white")
              }
            >
              {t}
            </button>
          ))}
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-sky-300/50 relative h-4">
          <span className={`absolute right-0 transition-opacity ${loading ? "opacity-100" : "opacity-0 pointer-events-none"}`}>Loading…</span>
          <span className={`absolute right-0 transition-opacity ${loading ? "opacity-0 pointer-events-none" : "opacity-100"}`}>{freshness.levels}</span>
        </div>
      </div>

      {!snapshot.available ? (
        <p className="font-mono text-sm text-sky-300/70">{snapshot.read}</p>
      ) : (
        <>
          <div className="flex items-end justify-between gap-4 mb-6">
            <div>
              <p className="font-mono text-[10px] tracking-[0.4em] text-cyan-300 uppercase mb-1">
                {snapshot.ticker} Spot
              </p>
              <p className="font-anton text-4xl md:text-5xl text-white leading-none tabular-nums">
                {fmtLevel(snapshot.spot)}
              </p>
              <p className={`mt-1 font-mono text-[10px] leading-snug ${freshness.priceNote ? "text-amber-300/70" : "text-transparent"} h-5`}>
                {freshness.priceNote || "Space reserved for market status"}
              </p>
            </div>
            <div className="text-right">
              <p
                className={
                  "font-mono text-lg font-bold tabular-nums " +
                  (snapshot.posture === "long" ? "text-cyan-300" : snapshot.posture === "short" ? "text-rose-400" : "text-white/50")
                }
              >
                {snapshot.posture === "long" ? "Long Gamma" : snapshot.posture === "short" ? "Short Gamma" : "—"}
              </p>
              <p className="font-mono text-[10px] text-sky-300/60 mt-1 uppercase tracking-widest">Regime</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 mb-6">
            <div className="rounded-md border border-white/10 bg-black/40 px-3 py-2 text-center">
              <p className="font-mono text-lg font-bold tabular-nums text-cyan-300">{fmtLevel(snapshot.call_wall)}</p>
              <p className="font-mono text-[10px] text-sky-300/60 uppercase tracking-widest mt-0.5">Call Wall</p>
              <WallRole role={snapshot.call_wall_role} kind="call" />
            </div>
            <div className="rounded-md border border-white/10 bg-black/40 px-3 py-2 text-center">
              <p className="font-mono text-lg font-bold tabular-nums text-white">{fmtLevel(snapshot.flip)}</p>
              <p className="font-mono text-[10px] text-sky-300/60 uppercase tracking-widest mt-0.5">Gamma Flip</p>
            </div>
            <div className="rounded-md border border-white/10 bg-black/40 px-3 py-2 text-center">
              <p className="font-mono text-lg font-bold tabular-nums text-rose-400">{fmtLevel(snapshot.put_wall)}</p>
              <p className="font-mono text-[10px] text-sky-300/60 uppercase tracking-widest mt-0.5">Put Wall</p>
              <WallRole role={snapshot.put_wall_role} kind="put" />
            </div>
          </div>

          <p className="font-mono text-xs text-sky-300/70 leading-relaxed">{snapshot.read}</p>
        </>
      )}
    </div>
  );
}
