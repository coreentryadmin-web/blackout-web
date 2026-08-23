"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import { usePulse } from "@/lib/usePulse";
import { relativeAge } from "@/lib/relative-time";
import { readDarkPoolBias, type DarkPoolBiasRead } from "@/features/helix/lib/helix-darkpool-bias";
// Code-split: the dark-pool sparkline (recharts) is the only recharts use in
// this file. It is extracted to DarkPoolSpark and lazy-loaded (ssr:false) so
// recharts stays out of DarkPoolPanel's static client graph while the rest of
// the panel (framer-motion markup) still SSR-renders unchanged.
const DarkPoolSpark = dynamic(
  () => import("@/features/helix/components/DarkPoolSpark").then((m) => m.DarkPoolSpark),
  { ssr: false, loading: () => null },
);
import { clsx } from "clsx";
import {
  fmtPremium,
  fetchDarkPoolPrints,
  type DarkPoolRow,
} from "@/lib/api";
import { darkpoolRowHighlighted, type HelixDarkpoolHighlight } from "@/features/helix/lib/use-helix-deep-link";
import { Panel, Skeleton, EmptyState } from "@/components/ui";

const POLL_MS     = 30_000;
const MAX_HISTORY = 20;

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Guarded via the shared relativeAge: a null/unparseable timestamp previously rendered "NaNh".
function timeAgo(iso: string | null | undefined): string {
  return relativeAge(iso);
}

function fmtDate(iso: string | null | undefined): string {
  // An undated print renders as the dash `relativeAge` already uses, NOT as today's date. The two
  // branches of the caller must agree about absence, or the same row reads "just now" in one column
  // width and "08/23 14:02" in another.
  if (iso == null || iso === "") return timeAgo(iso);
  try {
    const d = new Date(iso);
    // new Date(bad) is Invalid Date (does NOT throw), so getMonth() etc. would render "NaN/NaN".
    if (Number.isNaN(d.getTime())) return timeAgo(iso);
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const dy = String(d.getDate()).padStart(2, "0");
    const hr = String(d.getHours()).padStart(2, "0");
    const mn = String(d.getMinutes()).padStart(2, "0");
    return `${mo}/${dy} ${hr}:${mn}`;
  } catch {
    return timeAgo(iso);
  }
}

function fmtShares(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${Math.round(n / 1000)}K`;
  return String(n);
}

/**
 * Presentation for the dark-pool bias verdict. The JUDGEMENT lives in
 * `readDarkPoolBias` (helix-darkpool-bias.ts) — this only picks a colour for it.
 *
 * The ratio used to be computed here, over `buy / (buy + sell)`, which silently excluded every
 * print carrying no direction from its own denominator. See that module for the measurement and
 * why the coverage gate is the fix.
 *
 * `unreadable` renders as the same neutral dash the old all-neutral branch produced, and the
 * caller adds the coverage beside it — a dash on its own is indistinguishable from "no data",
 * which is the confusion this whole change is about.
 */
function biasStyle(read: DarkPoolBiasRead) {
  switch (read.label) {
    case "BULLISH": return { label: "BULLISH", color: "#a3e635", glow: "rgba(0,230,118,0.35)" };
    case "BEARISH": return { label: "BEARISH", color: "#ff2d55", glow: "rgba(255,45,85,0.35)" };
    case "MIXED":   return { label: "MIXED",   color: "#7dd3fc", glow: "rgba(125,211,252,0.3)" };
    default:        return { label: "—",       color: "#9fb4d4", glow: "rgba(159,180,212,0.2)" };
  }
}

/** The coverage line shown beside a refusal. `null` when there was no premium at all — "0% of
 *  side data" would assert a measurement over an empty population. */
function biasCoverageNote(read: DarkPoolBiasRead): string | null {
  if (!read.minorityEvidence) return null;
  if (read.readablePct == null) return null;
  return `side known on ${read.readablePct.toFixed(0)}% of premium`;
}

// ─── Shared print row ─────────────────────────────────────────────────────────

function PrintRow({
  p,
  showDate = false,
  highlighted = false,
}: {
  p: DarkPoolRow;
  showDate?: boolean;
  highlighted?: boolean;
}) {
  const isBuy  = p.side === "buy";
  const isSell = p.side === "sell";
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.18 }}
      className={clsx(
        "flex items-center gap-2 rounded-lg px-3 py-2.5 border transition-colors cursor-default",
        highlighted
          ? "border-sky-300/80 bg-sky-400/10 ring-1 ring-sky-300/50"
          : isBuy
            ? "border-bull/40 bg-bull/[0.08] hover:bg-bull/[0.14] hover:border-bull/60"
            : isSell
              ? "border-bear/40 bg-bear/[0.08] hover:bg-bear/[0.14] hover:border-bear/60"
              : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
      )}
      style={{
        boxShadow: isBuy  ? "inset 0 0 12px rgba(0,230,118,0.05)"
                  : isSell ? "inset 0 0 12px rgba(255,45,85,0.05)"
                  : "none",
      }}
    >
      {/* Side arrow */}
      <span
        className={clsx(
          "font-mono text-[14px] font-black w-4 flex-shrink-0",
          isBuy ? "text-bull" : isSell ? "text-bear-text" : "text-sky-300"
        )}
      >
        {isBuy ? "↑" : isSell ? "↓" : "—"}
      </span>

      {/* Ticker */}
      <span
        className="font-anton text-[24px] leading-none flex-shrink-0"
        style={{ color: isBuy ? "#6ee7b7" : isSell ? "#fda4af" : "#f4f6fb" }}
      >
        {p.ticker}
      </span>

      {/* Share size — the key "institutional block" metric */}
      {p.share_size != null && p.share_size > 0 && (
        <span
          className="font-mono text-[12px] font-semibold flex-shrink-0"
          style={{ color: isBuy ? "#6ee7b7" : isSell ? "#fda4af" : "#7dd3fc" }}
        >
          {fmtShares(p.share_size)} shares
        </span>
      )}

      {/* Block value */}
      <span
        className={clsx(
          "font-mono text-[15px] font-bold tabular-nums ml-auto flex-shrink-0",
          isBuy ? "num-bull" : isSell ? "num-bear" : "text-white"
        )}
      >
        {fmtPremium(p.premium)}
      </span>

      {/* Date or timeago */}
      <span className="font-mono text-[10px] text-cyan-400 flex-shrink-0 text-right"
        style={{ minWidth: showDate ? "72px" : "20px" }}>
        {showDate ? fmtDate(p.executed_at) : timeAgo(p.executed_at)}
      </span>
    </motion.div>
  );
}

// ─── Root component — all data fetched here, filtered client-side ─────────────

export function DarkPoolPanel({
  tapeTicker = "",
  highlight = null,
}: {
  tapeTicker?: string;
  highlight?: HelixDarkpoolHighlight;
}) {
  const [allPrints, setAllPrints]   = useState<DarkPoolRow[]>([]);
  const [loading, setLoading]       = useState(true);
  const [errored, setErrored]       = useState(false);
  const [history, setHistory]       = useState<{ t: number; net: number }[]>([]);
  const [search, setSearch]         = useState("");
  const [activeTicker, setActiveTicker] = useState("");
  const deskTicker = tapeTicker.trim().toUpperCase();

  // Fetch a larger pool so client-side ticker filtering actually finds prints
  const load = useCallback(async () => {
    try {
      const res  = await fetchDarkPoolPrints({ limit: 100 }); // API hard-caps at 100
      const rows = res.prints ?? [];
      setAllPrints(rows);
      setErrored(false);
      const buy  = rows.filter((p) => p.side === "buy").reduce((s, p) => s + p.premium, 0);
      const sell = rows.filter((p) => p.side === "sell").reduce((s, p) => s + p.premium, 0);
      setHistory((prev) => [...prev.slice(-(MAX_HISTORY - 1)), { t: Date.now(), net: buy - sell }]);
    } catch (e) { console.warn("[DarkPoolPanel] fetch error:", e); setErrored(true); }
    finally   { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  // Debounce local search only when the desk command bar has no ticker filter.
  useEffect(() => {
    if (deskTicker) return;
    const val = search.trim().toUpperCase();
    const id  = setTimeout(() => setActiveTicker(val), 400);
    return () => clearTimeout(id);
  }, [search, deskTicker]);

  useEffect(() => {
    if (deskTicker) setSearch("");
  }, [deskTicker]);

  const filterTicker = deskTicker || activeTicker;

  // Filtered view
  const visible = filterTicker
    ? allPrints.filter((p) => p.ticker === filterTicker)
    : allPrints.slice(0, 60);

  const biasRead   = readDarkPoolBias(visible);
  const bias       = biasStyle(biasRead);
  const biasNote   = biasCoverageNote(biasRead);
  const latestNet  = history[history.length - 1]?.net ?? 0;
  const isBull     = latestNet >= 0;
  const sparkColor = isBull ? "#a3e635" : "#ff2d55";

  // Ticker summary stats
  const tickerTotal = visible.reduce((s, p) => s + p.premium, 0);

  // Hoisted (no early return in this component, but kept top-level for Rules of Hooks).
  const pulse = usePulse({ opacity: [1, 0.3, 1] }, { repeat: Infinity, duration: 2.5, ease: "easeInOut" });

  return (
    <Panel
      accent="sky"
      strip={false}
      className="helix-pro-rail-panel"
      bodyClassName="!px-3 !py-2.5"
      header={
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-white/10 px-3 py-2">
          <div className="flex items-center gap-2 flex-shrink-0">
            <motion.span {...pulse} className="text-[10px] text-purple-light/80">
              ⬡
            </motion.span>
            <h3 className="font-mono text-[11px] uppercase tracking-[0.2em] text-white">Dark Pool</h3>
          </div>

          {deskTicker ? (
            <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-purple-light ml-auto">
              {deskTicker}
            </span>
          ) : (
            <div className="relative ml-auto">
              <input
                value={search}
                onChange={(e) =>
                  setSearch(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6))
                }
                placeholder="NVDA, TSLA…"
                aria-label="Filter dark pool blocks by ticker"
                maxLength={6}
                className="font-mono text-[11px] font-bold uppercase px-3 py-1 rounded-lg border bg-[rgba(8,9,14,0.85)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#bf5fff] w-28 tracking-widest transition-all"
                style={{
                  borderColor: search ? "rgba(191,95,255,0.65)" : "rgba(191,95,255,0.22)",
                  color: search ? "#d580ff" : "#7dd3fc",
                  boxShadow: search ? "0 0 0 2px rgba(191,95,255,0.12)" : "none",
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
                    aria-label="Clear ticker filter"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-cyan-400 hover:text-sky-200 font-mono text-sm font-bold"
                  >
                    ×
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      }
    >
      {/* ── Body ── */}
      <div className="flow-panel-body">
        <AnimatePresence mode="wait">
          <motion.div
            key={filterTicker || "__market__"}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
          >
            {/* ── Ticker header (when filtering) ── */}
            {filterTicker && (
              <div className="mb-3 rounded-xl border border-purple/30 bg-purple/[0.08] px-3 py-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-anton text-[24px] text-purple-light leading-none">
                      {filterTicker}
                    </span>
                    {visible.length > 0 && (
                      <span className="font-mono text-[11px] text-cyan-400">
                        {visible.length} block{visible.length !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                  {visible.length > 0 && (
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-[15px] font-bold tabular-nums text-purple-light">
                        {fmtPremium(tickerTotal)}
                      </span>
                      <span
                        className="font-mono text-[11px] font-bold px-2 py-0.5 rounded border"
                        style={{
                          color: bias.color,
                          background: "rgba(0,0,0,0.5)",
                          borderColor: `${bias.color}44`,
                        }}
                      >
                        {bias.label}
                      </span>
                      {biasNote && (
                        <span className="font-mono text-[10px] text-purple-light/60">{biasNote}</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Market bias + sparkline (market view only) ── */}
            {!filterTicker && !loading && allPrints.length > 0 && (
              <div className="flex items-center gap-3 px-1 mb-2">
                <span
                  className="font-mono text-[11px] font-bold px-2 py-0.5 rounded border"
                  style={{
                    color: bias.color,
                    background: "rgba(0,0,0,0.5)",
                    borderColor: `${bias.color}44`,
                  }}
                >
                  {bias.label}
                </span>
                {biasNote && (
                  <span className="font-mono text-[10px] text-purple-light/60">{biasNote}</span>
                )}
                {history.length >= 3 && (
                  <div className="flex-1 h-6">
                    <DarkPoolSpark history={history} color={sparkColor} />
                  </div>
                )}
                <span
                  className="font-mono text-xs font-bold tabular-nums"
                  style={{ color: sparkColor }}
                >
                  {isBull ? "+" : ""}{fmtPremium(latestNet)}
                </span>
              </div>
            )}

            {/* ── Prints list ── */}
            <div
              className="flow-scroll overflow-y-auto"
              style={{ maxHeight: 300 }}
              role="log"
              aria-live="polite"
              aria-label="Dark pool block prints"
            >
              {loading ? (
                <div className="space-y-1.5">
                  {[1, 2, 3, 4].map((n) => <Skeleton key={n} height={44} rounded="md" />)}
                </div>
              ) : errored && allPrints.length === 0 ? (
                <EmptyState
                  className="!border-bear/30 !py-8"
                  icon={<span className="text-bear">⚠</span>}
                  title={<span className="text-bear-text">Feed unavailable</span>}
                  description="Couldn't reach the dark pool tape — retrying shortly"
                  role="alert"
                />
              ) : visible.length === 0 ? (
                <EmptyState
                  className="!py-8"
                  icon="⬡"
                  title={filterTicker ? `No blocks for ${filterTicker}` : "No blocks yet"}
                  description={
                    filterTicker
                      ? "Nothing on the current tape — try a high-volume ticker like NVDA, TSLA, SPY"
                      : "No blocks on the tape yet"
                  }
                />
              ) : (
                <AnimatePresence initial={false}>
                  <div className="space-y-1">
                    {visible.map((p, i) => (
                      <PrintRow
                        key={`${p.ticker}-${p.executed_at}-${i}`}
                        p={p}
                        showDate={!!filterTicker}
                        highlighted={darkpoolRowHighlighted(p, highlight)}
                      />
                    ))}
                  </div>
                </AnimatePresence>
              )}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </Panel>
  );
}
