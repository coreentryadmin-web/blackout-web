"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  if (!role) return null;
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

function fmtAge(asof: string | null): string {
  if (!asof) return "—";
  const ms = Date.now() - new Date(asof).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins === 1) return "1 min ago";
  return `${mins} min ago`;
}

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
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-sky-300/50">
          {loading ? "Loading…" : `Updated ${fmtAge(snapshot.asof)}`}
        </p>
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
