"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import { Badge } from "@/components/ui";
import { buildIntelNote } from "@/lib/zerodte/intel";
import {
  advancePlayLatch,
  isZeroDteMarkStale,
  pinnedLivePnlPct,
  type PlayLatch,
} from "@/lib/zerodte/marks-math";
import { PLAN_RULES } from "@/lib/zerodte/plan";
import {
  LIVE_SIM_ENTRY,
  LIVE_SIM_MOCK_SETUP,
  LIVE_SIM_SCENARIO,
  resolveSimQuote,
  type LiveSimTick,
} from "@/lib/zerodte/live-sim-scenario";

const TICK_MS = 1_000;

type TickRecord = {
  idx: number;
  tick: LiveSimTick;
  status: string;
  pnl: number | null;
  intelAction: string;
  intelReason: string;
  changed: string[];
};

function fmtEt(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, "0")} ET`;
}

/** Dev-only: replays mock marks at 1Hz using production latch + intel math. */
export function ZeroDteLiveSimDemo() {
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [latch, setLatch] = useState<PlayLatch | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [log, setLog] = useState<TickRecord[]>([]);
  const prevRef = useRef<{ status: string; pnl: number | null; mark: number } | null>(null);
  const lastLoggedIdxRef = useRef(-1);

  const tick = LIVE_SIM_SCENARIO[Math.min(idx, LIVE_SIM_SCENARIO.length - 1)]!;
  const quote = resolveSimQuote(tick);
  const etMinutes = tick.etMinutes ?? 10 * 60 + 5 + idx;

  const pnl = pinnedLivePnlPct(LIVE_SIM_ENTRY, quote.mark);
  const stop = LIVE_SIM_ENTRY * (1 + PLAN_RULES.stop_pct / 100);
  const target = LIVE_SIM_ENTRY * (1 + PLAN_RULES.target_pct / 100);
  const stale = isZeroDteMarkStale(nowMs - 500, nowMs);

  const nextLatch = useMemo(() => {
    return advancePlayLatch(
      { entry_premium: LIVE_SIM_ENTRY, peak_premium: latch?.peak ?? null, trough_premium: latch?.trough ?? null },
      latch,
      quote.mark,
      etMinutes
    );
  }, [latch, quote.mark, etMinutes]);

  const intel = useMemo(() => {
    const status = nextLatch.status;
    return buildIntelNote({
      status,
      setup: LIVE_SIM_MOCK_SETUP,
      plan: LIVE_SIM_MOCK_SETUP.plan,
      entryPremium: LIVE_SIM_ENTRY,
      livePnlPct: pnl,
      planOutcome: null,
      planPnlPct: null,
      nowEtMinutes: etMinutes,
      lastMark: quote.mark,
    });
  }, [nextLatch.status, pnl, quote.mark, etMinutes]);

  const applyTick = useCallback(() => {
    setIdx((i) => {
      const next = Math.min(i + 1, LIVE_SIM_SCENARIO.length - 1);
      return next;
    });
    setNowMs(Date.now());
  }, []);

  useEffect(() => {
    setLatch(nextLatch);
  }, [nextLatch]);

  useEffect(() => {
    if (lastLoggedIdxRef.current === idx) return;
    lastLoggedIdxRef.current = idx;

    const prev = prevRef.current;
    const changed: string[] = [];
    if (!prev || prev.mark !== quote.mark) changed.push("mark / bid·ask (SSE ~1s)");
    if (!prev || prev.pnl !== pnl) changed.push("live_pnl_pct (SSE ~1s)");
    if (!prev || prev.status !== nextLatch.status) changed.push("status OPEN→HOLD→TRIM (SSE ~1s)");
    changed.push("intel verb + distances (recomputed each tick)");
    if (idx === 0) changed.push("ledger commit (one-time)");

    const record: TickRecord = {
      idx,
      tick,
      status: nextLatch.status,
      pnl,
      intelAction: intel.action,
      intelReason: intel.reason,
      changed,
    };
    setLog((rows) => [record, ...rows].slice(0, 12));
    prevRef.current = { status: nextLatch.status, pnl, mark: quote.mark };
  }, [idx, tick, quote.mark, pnl, nextLatch.status, intel]);

  useEffect(() => {
    if (!playing || idx >= LIVE_SIM_SCENARIO.length - 1) return;
    const id = setInterval(applyTick, TICK_MS);
    return () => clearInterval(id);
  }, [playing, idx, applyTick]);

  const done = idx >= LIVE_SIM_SCENARIO.length - 1;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-3 py-6">
      <header className="space-y-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-bull/85">Dev · mock market data</p>
        <h1 className="font-anton text-3xl uppercase tracking-wide text-white">0DTE live lifecycle sim</h1>
        <p className="max-w-3xl text-sm leading-relaxed text-sky-300/80">
          Replays one committed <strong className="text-white">NVDA 880C</strong> at{" "}
          <strong className="t-num text-white">1 tick / second</strong> using the same code paths as production:{" "}
          <code className="text-gold/90">advancePlayLatch</code>,{" "}
          <code className="text-gold/90">derivePlayStatus</code>,{" "}
          <code className="text-gold/90">buildIntelNote</code>,{" "}
          <code className="text-gold/90">pinnedLivePnlPct</code>.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
        <div className="rounded-xl border border-bull/25 bg-bull/[0.04] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-bull shadow-[0_0_8px_rgba(34,197,94,0.8)]" aria-hidden />
            <Badge tone="bull" size="sm">
              {nextLatch.status}
            </Badge>
            <span className="t-num text-[15px] font-bold text-white">NVDA 880C</span>
            <Badge tone="bull" size="sm">
              long
            </Badge>
            <Badge tone="bull" size="sm">
              sim SSE
            </Badge>
            <span className="ml-auto font-mono text-[10px] uppercase tracking-widest text-sky-300/50">
              tick {idx + 1}/{LIVE_SIM_SCENARIO.length}
            </span>
          </div>

          <p className="mb-3 font-mono text-[11px] text-gold/90">{tick.label}</p>

          <div className="flex flex-wrap gap-x-6 gap-y-2 text-[12px]">
            <span>
              <span className="font-mono text-[9px] uppercase tracking-widest text-sky-300/50">flow fill </span>
              <strong className="t-num text-white">${LIVE_SIM_ENTRY.toFixed(2)}</strong>
            </span>
            <span className={clsx(stale && "opacity-40")}>
              <span className="font-mono text-[9px] uppercase tracking-widest text-sky-300/50">mark · mid </span>
              <strong className="t-num text-white">${quote.mark.toFixed(2)}</strong>
              <span className="t-num ml-1 text-[10px] text-sky-300/60">
                {quote.bid.toFixed(2)}×{quote.ask.toFixed(2)}
              </span>
            </span>
            <span>
              <span className="font-mono text-[9px] uppercase tracking-widest text-sky-300/50">PnL </span>
              <strong className={clsx("t-num font-bold", (pnl ?? 0) >= 0 ? "text-bull" : "text-bear")}>
                {pnl != null ? `${pnl >= 0 ? "+" : ""}${pnl.toFixed(1)}%` : "—"}
              </strong>
            </span>
            <span>
              <span className="font-mono text-[9px] uppercase tracking-widest text-sky-300/50">clock </span>
              <strong className="t-num text-white">{fmtEt(etMinutes)}</strong>
            </span>
          </div>

          <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-sky-300/75">
            <span>
              Stop <strong className="t-num text-white">${stop.toFixed(2)}</strong> (−50%)
            </span>
            <span>
              Trim <strong className="t-num text-white">${target.toFixed(2)}</strong> (+100%)
            </span>
            <span>
              Peak <strong className="t-num text-white">${(nextLatch.peak ?? LIVE_SIM_ENTRY).toFixed(2)}</strong>
            </span>
            <span>
              Trough <strong className="t-num text-white">${(nextLatch.trough ?? LIVE_SIM_ENTRY).toFixed(2)}</strong>
            </span>
          </div>

          <div className="mt-4 border-t border-white/[0.06] pt-3">
            <div className="flex items-start gap-2">
              <Badge
                tone={
                  intel.action === "TRIM" ? "sky" : intel.action === "ADD" ? "bull" : intel.action === "SELL" ? "bear" : "neutral"
                }
                size="sm"
                className="mt-0.5 shrink-0"
              >
                {intel.action}
              </Badge>
              <p className="text-[12px] leading-snug text-sky-200/90">{intel.reason}</p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg border border-bull/35 bg-bull/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-bull"
              onClick={() => {
                setIdx(0);
                setLatch(null);
                setLog([]);
                prevRef.current = null;
                lastLoggedIdxRef.current = -1;
                setPlaying(true);
                setNowMs(Date.now());
              }}
            >
              Restart
            </button>
            <button
              type="button"
              className="rounded-lg border border-white/15 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-sky-200/90"
              onClick={() => setPlaying((p) => !p)}
            >
              {playing && !done ? "Pause" : "Play"}
            </button>
            <button
              type="button"
              className="rounded-lg border border-white/15 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-sky-200/90"
              onClick={applyTick}
              disabled={done}
            >
              Step +1s
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <section className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
            <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-gold/85">What updates how fast</h2>
            <ul className="mt-3 space-y-2 text-[12px] leading-relaxed text-sky-200/85">
              <li>
                <strong className="text-bull">~1s SSE</strong> (simulated here): option mark, bid/ask, P&amp;L vs pinned
                entry, OPEN/HOLD/TRIM status latch, intel HOLD/TRIM distances + countdowns.
              </li>
              <li>
                <strong className="text-sky-300">~5–10s REST board</strong> (frozen in demo): Cortex evidence, tier factors,
                scan score, governor, fresh-find gates,{" "}
                <em>dealer gamma_regime</em> (positioning label — not contract Greeks).
              </li>
              <li>
                <strong className="text-sky-300/60">Static at commit</strong>: entry premium, OCC, merit tier grade.
              </li>
              <li>
                <strong className="text-bear/90">Not in 0DTE UI today</strong>: live contract Δ/Γ/Θ/Vega — trade management
                is premium + plan rules + tape context, not an options greeks panel.
              </li>
            </ul>
          </section>

          <section className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
            <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-gold/85">Tick log</h2>
            <ul className="mt-3 max-h-[320px] space-y-2 overflow-y-auto font-mono text-[10px] leading-snug text-sky-300/80">
              {log.map((row) => (
                <li key={`${row.idx}-${row.tick.label}`} className="rounded-md border border-white/[0.06] px-2 py-1.5">
                  <div className="text-gold/90">
                    +{row.idx}s · {row.status} · {row.pnl != null ? `${row.pnl >= 0 ? "+" : ""}${row.pnl.toFixed(1)}%` : "—"} ·{" "}
                    {row.intelAction}
                  </div>
                  <div className="text-sky-300/60">{row.tick.label}</div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
