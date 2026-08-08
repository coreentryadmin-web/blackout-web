"use client";

import { useState } from "react";
import type { PublicGexSnapshot, PublicGexTicker } from "@/lib/public-gex-snapshot";

const TICKERS: PublicGexTicker[] = ["SPX", "SPY", "QQQ"];

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

  async function selectTicker(next: PublicGexTicker) {
    if (next === ticker) return;
    setTicker(next);
    setLoading(true);
    try {
      const res = await fetch(`/api/public/gex-snapshot?ticker=${next}`, { cache: "no-store" });
      if (res.ok) setSnapshot(await res.json());
    } catch {
      /* keep showing the last good snapshot */
    } finally {
      setLoading(false);
    }
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
            </div>
            <div className="rounded-md border border-white/10 bg-black/40 px-3 py-2 text-center">
              <p className="font-mono text-lg font-bold tabular-nums text-white">{fmtLevel(snapshot.flip)}</p>
              <p className="font-mono text-[10px] text-sky-300/60 uppercase tracking-widest mt-0.5">Gamma Flip</p>
            </div>
            <div className="rounded-md border border-white/10 bg-black/40 px-3 py-2 text-center">
              <p className="font-mono text-lg font-bold tabular-nums text-rose-400">{fmtLevel(snapshot.put_wall)}</p>
              <p className="font-mono text-[10px] text-sky-300/60 uppercase tracking-widest mt-0.5">Put Wall</p>
            </div>
          </div>

          <p className="font-mono text-xs text-sky-300/70 leading-relaxed">{snapshot.read}</p>
        </>
      )}
    </div>
  );
}
