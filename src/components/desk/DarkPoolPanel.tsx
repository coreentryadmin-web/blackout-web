"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AreaChart, Area, ResponsiveContainer, ReferenceLine } from "recharts";
import { clsx } from "clsx";
import {
  fmtPremium,
  fetchDarkPoolPrints,
  fetchDarkPoolTicker,
  type DarkPoolRow,
  type DarkPoolTickerSnapshot,
} from "@/lib/api";

const POLL_MS     = 30_000;
const MAX_HISTORY = 20;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

function fmtShares(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${Math.round(n / 1000)}K`;
  return String(n);
}

function biasFromSide(prints: DarkPoolRow[]) {
  const buy   = prints.filter((p) => p.side === "buy").reduce((s, p) => s + p.premium, 0);
  const sell  = prints.filter((p) => p.side === "sell").reduce((s, p) => s + p.premium, 0);
  const total = buy + sell;
  if (total <= 0) return { label: "MIXED",   color: "#71717a", glow: "rgba(113,113,122,0.3)" };
  const r = buy / total;
  if (r >= 0.65) return { label: "BULLISH",  color: "#34d399", glow: "rgba(52,211,153,0.35)" };
  if (r <= 0.35) return { label: "BEARISH",  color: "#fb7185", glow: "rgba(251,113,133,0.35)" };
  return         { label: "MIXED",   color: "#94a3b8", glow: "rgba(148,163,184,0.2)" };
}

function biasFromSnapshot(snap: DarkPoolTickerSnapshot) {
  const b = snap.bias.toLowerCase();
  if (b === "bullish") return { label: "BULLISH", color: "#34d399", glow: "rgba(52,211,153,0.35)" };
  if (b === "bearish") return { label: "BEARISH", color: "#fb7185", glow: "rgba(251,113,133,0.35)" };
  return               { label: "MIXED",   color: "#94a3b8", glow: "rgba(148,163,184,0.2)" };
}

// ─────────────────────────────────────────────────────────────────────────────
// Market-wide view (default when search is empty)
// ─────────────────────────────────────────────────────────────────────────────

function MarketView() {
  const [prints, setPrints]   = useState<DarkPoolRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<{ t: number; net: number }[]>([]);

  const load = useCallback(async () => {
    try {
      const res  = await fetchDarkPoolPrints({ limit: 60 });
      const rows = res.prints ?? [];
      setPrints(rows);
      const buy  = rows.filter((p) => p.side === "buy").reduce((s, p) => s + p.premium, 0);
      const sell = rows.filter((p) => p.side === "sell").reduce((s, p) => s + p.premium, 0);
      setHistory((prev) => [...prev.slice(-(MAX_HISTORY - 1)), { t: Date.now(), net: buy - sell }]);
    } catch { /* silently ignore */ }
    finally   { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const bias       = biasFromSide(prints);
  const latestNet  = history[history.length - 1]?.net ?? 0;
  const isBull     = latestNet >= 0;
  const sparkColor = isBull ? "#34d399" : "#fb7185";

  return (
    <div className="space-y-2">
      {/* Bias + sparkline */}
      {!loading && prints.length > 0 && (
        <div className="flex items-center gap-3 px-1 mb-1">
          <span
            className="font-mono text-[10px] font-bold px-2 py-0.5 rounded"
            style={{
              color: bias.color,
              background: "rgba(0,0,0,0.5)",
              border: `1px solid ${bias.color}44`,
              boxShadow: `0 0 8px ${bias.glow}`,
            }}
          >
            {bias.label}
          </span>
          {history.length >= 3 && (
            <div className="flex-1 h-6">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={history} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="dpSparkGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"   stopColor={sparkColor} stopOpacity={0.45} />
                      <stop offset="100%" stopColor={sparkColor} stopOpacity={0}    />
                    </linearGradient>
                  </defs>
                  <ReferenceLine y={0} stroke="#3f3f46" strokeWidth={1} />
                  <Area type="monotone" dataKey="net" stroke={sparkColor} strokeWidth={2}
                    fill="url(#dpSparkGrad)" dot={false} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
          <span
            className="font-mono text-[11px] font-bold tabular-nums"
            style={{ color: sparkColor, textShadow: `0 0 8px ${sparkColor}66` }}
          >
            {isBull ? "+" : ""}{fmtPremium(latestNet)}
          </span>
        </div>
      )}

      {/* Prints list */}
      <div className="flow-scroll overflow-y-auto" style={{ maxHeight: 280 }}>
        {loading ? (
          <div className="space-y-1.5">
            {[1, 2, 3, 4].map((n) => <div key={n} className="flow-skeleton h-11 rounded-md" />)}
          </div>
        ) : prints.length === 0 ? (
          <p className="font-mono text-[10px] text-zinc-600 text-center py-6">No prints available</p>
        ) : (
          <AnimatePresence initial={false}>
            <div className="space-y-1">
              {prints.map((p, i) => {
                const isBuy  = p.side === "buy";
                const isSell = p.side === "sell";
                return (
                  <motion.div
                    key={`${p.ticker}-${p.executed_at}-${i}`}
                    layout
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.02, duration: 0.18 }}
                    className={clsx(
                      "flex items-center gap-2 rounded-lg px-3 py-2.5 border transition-colors cursor-default",
                      isBuy  ? "border-emerald-600/40 bg-emerald-950/25 hover:bg-emerald-950/40 hover:border-emerald-500/60" :
                      isSell ? "border-rose-600/40    bg-rose-950/25    hover:bg-rose-950/40    hover:border-rose-500/60" :
                               "border-zinc-700/30    bg-zinc-900/20    hover:bg-zinc-900/40"
                    )}
                    style={{
                      boxShadow: isBuy  ? "inset 0 0 12px rgba(52,211,153,0.05)"
                                : isSell ? "inset 0 0 12px rgba(251,113,133,0.05)"
                                : "none",
                    }}
                  >
                    {/* Side arrow */}
                    <span
                      className="font-mono text-[14px] font-black w-4 flex-shrink-0"
                      style={{
                        color: isBuy ? "#34d399" : isSell ? "#fb7185" : "#52525b",
                        textShadow: isBuy  ? "0 0 6px rgba(52,211,153,0.6)"
                                  : isSell ? "0 0 6px rgba(251,113,133,0.6)"
                                  : "none",
                      }}
                    >
                      {isBuy ? "↑" : isSell ? "↓" : "—"}
                    </span>

                    {/* Ticker */}
                    <span
                      className="font-anton text-[14px] leading-none flex-shrink-0"
                      style={{ color: isBuy ? "#6ee7b7" : isSell ? "#fda4af" : "#d4d4d8" }}
                    >
                      {p.ticker}
                    </span>

                    {/* Share size */}
                    {p.share_size != null && p.share_size > 0 && (
                      <span className="font-mono text-[9px] text-zinc-600 flex-shrink-0">
                        {fmtShares(p.share_size)}sh
                      </span>
                    )}

                    {/* Premium */}
                    <span
                      className="font-mono text-[13px] font-bold tabular-nums ml-auto flex-shrink-0"
                      style={{
                        color: isBuy ? "#34d399" : isSell ? "#fb7185" : "#e4e4e7",
                        textShadow: isBuy  ? "0 0 8px rgba(52,211,153,0.5)"
                                  : isSell ? "0 0 8px rgba(251,113,133,0.5)"
                                  : "none",
                      }}
                    >
                      {fmtPremium(p.premium)}
                    </span>

                    {/* Time */}
                    <span className="font-mono text-[9px] text-zinc-600 flex-shrink-0 w-5 text-right">
                      {timeAgo(p.executed_at)}
                    </span>
                  </motion.div>
                );
              })}
            </div>
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-ticker view (shown when user types a ticker in the search field)
// ─────────────────────────────────────────────────────────────────────────────

function TickerView({ symbol }: { symbol: string }) {
  const [snap, setSnap]       = useState<DarkPoolTickerSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<{ t: number; net: number }[]>([]);

  useEffect(() => {
    let cancelled = false;
    const histLocal: { t: number; net: number }[] = [];

    const doLoad = async () => {
      try {
        const res = await fetchDarkPoolTicker(symbol);
        if (cancelled) return;
        const s = res.snapshot;
        setSnap(s);
        if (s) {
          const net = s.call_premium - s.put_premium;
          histLocal.push({ t: Date.now(), net });
          if (histLocal.length > MAX_HISTORY) histLocal.shift();
          setHistory([...histLocal]);
        }
      } catch { /* silently ignore */ }
      finally { if (!cancelled) setLoading(false); }
    };

    setLoading(true);
    setSnap(null);
    setHistory([]);
    doLoad();
    const id = setInterval(doLoad, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [symbol]);

  if (loading) {
    return (
      <div className="space-y-2">
        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 3].map((n) => <div key={n} className="flow-skeleton h-14 rounded-md" />)}
        </div>
        {[1, 2, 3].map((n) => <div key={n} className="flow-skeleton h-10 rounded-md" />)}
      </div>
    );
  }

  if (!snap) {
    return (
      <p className="font-mono text-[10px] text-zinc-600 text-center py-6">
        No dark pool data for {symbol}
      </p>
    );
  }

  const total      = snap.total_premium;
  const callPct    = total > 0 ? Math.round((snap.call_premium / total) * 100) : 0;
  const bias       = biasFromSnapshot(snap);
  const latestNet  = history[history.length - 1]?.net ?? 0;
  const isBull     = latestNet >= 0;
  const sparkColor = isBull ? "#34d399" : "#fb7185";

  return (
    <div className="space-y-3">
      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg border border-zinc-700/50 bg-zinc-900/50 px-2.5 py-2">
          <p className="font-mono text-[8px] text-zinc-500 uppercase tracking-widest mb-1">Total</p>
          <p className="font-mono text-[13px] font-bold text-white tabular-nums">{fmtPremium(total)}</p>
        </div>
        <div className="rounded-lg border border-emerald-600/40 bg-emerald-950/25 px-2.5 py-2">
          <p className="font-mono text-[8px] text-emerald-600 uppercase tracking-widest mb-1">Calls</p>
          <p
            className="font-mono text-[13px] font-bold tabular-nums"
            style={{ color: "#34d399", textShadow: "0 0 8px rgba(52,211,153,0.4)" }}
          >
            {fmtPremium(snap.call_premium)}
          </p>
        </div>
        <div className="rounded-lg border border-rose-600/40 bg-rose-950/25 px-2.5 py-2">
          <p className="font-mono text-[8px] text-rose-600 uppercase tracking-widest mb-1">Puts</p>
          <p
            className="font-mono text-[13px] font-bold tabular-nums"
            style={{ color: "#fb7185", textShadow: "0 0 8px rgba(251,113,133,0.4)" }}
          >
            {fmtPremium(snap.put_premium)}
          </p>
        </div>
      </div>

      {/* Call/Put bar + bias + PCR */}
      <div className="space-y-1.5">
        <div className="h-2 rounded-full overflow-hidden bg-zinc-900 flex">
          <motion.div
            className="h-full"
            style={{ background: "linear-gradient(90deg, #065f46, #34d399)" }}
            initial={{ width: 0 }}
            animate={{ width: `${callPct}%` }}
            transition={{ duration: 0.8, ease: [0.34, 1.56, 0.64, 1] }}
          />
          <motion.div
            className="h-full flex-1"
            style={{ background: "linear-gradient(90deg, #9f1239, #fb7185)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.1 }}
          />
        </div>
        <div className="flex items-center justify-between">
          <span
            className="font-mono text-[10px] font-bold px-2 py-0.5 rounded"
            style={{
              color: bias.color,
              border: `1px solid ${bias.color}44`,
              background: "rgba(0,0,0,0.5)",
              boxShadow: `0 0 8px ${bias.glow}`,
            }}
          >
            {bias.label}
          </span>
          <div className="flex items-center gap-3">
            {snap.pcr != null && (
              <span className="font-mono text-[9px] text-zinc-500">PCR {snap.pcr.toFixed(2)}</span>
            )}
            <span className="font-mono text-[10px] font-semibold" style={{ color: "#34d399" }}>
              {callPct}% C
            </span>
            <span className="font-mono text-[10px] font-semibold" style={{ color: "#fb7185" }}>
              {100 - callPct}% P
            </span>
          </div>
        </div>
      </div>

      {/* Net history sparkline */}
      {history.length >= 3 && (
        <div className="h-8">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={history} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={`dpTickerGrad-${symbol}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor={sparkColor} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={sparkColor} stopOpacity={0}   />
                </linearGradient>
              </defs>
              <ReferenceLine y={0} stroke="#3f3f46" strokeWidth={1} />
              <Area type="monotone" dataKey="net" stroke={sparkColor} strokeWidth={2}
                fill={`url(#dpTickerGrad-${symbol})`} dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Strike-level prints */}
      {snap.prints.length > 0 && (
        <div className="flow-scroll overflow-y-auto" style={{ maxHeight: 180 }}>
          <p className="font-mono text-[8px] tracking-[0.25em] uppercase text-zinc-600 mb-2">
            Prints · {snap.prints.length}
          </p>
          <div className="space-y-1">
            {snap.prints.map((p, i) => {
              const isBuy  = p.side === "buy";
              const isSell = p.side === "sell";
              return (
                <motion.div
                  key={`${p.strike}-${p.executed_at}-${i}`}
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.03, duration: 0.18 }}
                  className={clsx(
                    "flex items-center gap-2 rounded-md border px-2.5 py-1.5",
                    isBuy  ? "border-emerald-600/40 bg-emerald-950/20" :
                    isSell ? "border-rose-600/40    bg-rose-950/20" :
                             "border-zinc-700/30    bg-zinc-900/20"
                  )}
                >
                  <span
                    className="font-mono text-[12px] font-black w-4"
                    style={{
                      color: isBuy ? "#34d399" : isSell ? "#fb7185" : "#52525b",
                      textShadow: isBuy  ? "0 0 6px rgba(52,211,153,0.6)"
                                : isSell ? "0 0 6px rgba(251,113,133,0.6)"
                                : "none",
                    }}
                  >
                    {isBuy ? "↑" : isSell ? "↓" : "—"}
                  </span>
                  <span className="font-mono text-[10px] text-zinc-400 font-medium">
                    ${p.strike > 0 ? p.strike : "—"}
                  </span>
                  <span
                    className="font-mono text-[11px] font-bold tabular-nums ml-auto"
                    style={{
                      color: isBuy ? "#34d399" : isSell ? "#fb7185" : "#e4e4e7",
                      textShadow: isBuy  ? "0 0 6px rgba(52,211,153,0.45)"
                                : isSell ? "0 0 6px rgba(251,113,133,0.45)"
                                : "none",
                    }}
                  >
                    {fmtPremium(p.premium)}
                  </span>
                  <span className="font-mono text-[9px] text-zinc-600 w-5 text-right flex-shrink-0">
                    {timeAgo(p.executed_at)}
                  </span>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Root component
// ─────────────────────────────────────────────────────────────────────────────

export function DarkPoolPanel() {
  const [search, setSearch]             = useState("");
  const [activeTicker, setActiveTicker] = useState("");

  // Debounce: switch to ticker view 400ms after user stops typing
  useEffect(() => {
    const val = search.trim().toUpperCase();
    const id  = setTimeout(() => setActiveTicker(val), 400);
    return () => clearTimeout(id);
  }, [search]);

  return (
    <div className="flow-panel">
      {/* Header */}
      <div className="flow-panel-header flex-wrap gap-y-2">
        <div className="flex items-center gap-2 flex-shrink-0">
          <motion.span
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ repeat: Infinity, duration: 2.5, ease: "easeInOut" }}
            className="text-[11px]"
            style={{ color: "#a78bfa", textShadow: "0 0 8px rgba(167,139,250,0.6)" }}
          >
            ⬡
          </motion.span>
          <span className="flow-panel-title">Dark Pool</span>
        </div>

        {/* Search — replaces old tabs + premium filters */}
        <div className="relative ml-auto">
          <input
            value={search}
            onChange={(e) =>
              setSearch(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6))
            }
            placeholder="NVDA, TSLA…"
            maxLength={6}
            className="font-mono text-[11px] font-bold uppercase px-3 py-1 rounded-lg border bg-zinc-950 outline-none w-28 tracking-widest transition-all"
            style={{
              borderColor: search ? "rgba(167,139,250,0.65)" : "rgba(167,139,250,0.22)",
              color:       search ? "#c4b5fd" : "#52525b",
              boxShadow:   search ? "0 0 0 2px rgba(167,139,250,0.12)" : "none",
            }}
          />
          <AnimatePresence>
            {search && (
              <motion.button
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 font-mono text-sm font-bold"
              >
                ×
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Body */}
      <div className="flow-panel-body">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTicker || "__market__"}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
          >
            {activeTicker ? (
              <TickerView symbol={activeTicker} />
            ) : (
              <MarketView />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
