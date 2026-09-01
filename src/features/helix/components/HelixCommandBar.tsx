"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { clsx } from "clsx";
import type { HelixDteFilter, HelixTableDensity } from "@/features/helix/lib/helix-table-columns";
import {
  HELIX_DEFAULT_MIN_PREMIUM,
  HELIX_PREMIUM_PRESETS,
} from "@/features/helix/lib/helix-flow-limits";
import { watchlistFilterActive } from "@/features/helix/lib/helix-watchlist-filter";
import {
  HELIX_FILTER_PRESETS,
  helixPresetMatches,
  type HelixDirectionFilter,
} from "@/features/helix/lib/helix-filter-presets";

const DTE_OPTIONS: { id: HelixDteFilter; label: string }[] = [
  { id: "all", label: "All DTE" },
  { id: "0dte", label: "0DTE" },
  { id: "week", label: "≤7d" },
  { id: "month+", label: ">7d" },
];
export type HelixTypeFilter = "ALL" | "CALL" | "PUT";

/** Count of non-default tape filters — drives the mobile trigger's "Filters · N" label
 *  so a member can tell at a glance whether the sheet is worth opening. */
export function countActiveHelixFilters(f: {
  minPremium: number;
  typeFilter: HelixTypeFilter;
  whalesOnly: boolean;
  dteFilter: HelixDteFilter;
  indicesOnly: boolean;
  watchlistOnly: boolean;
  /** How many tickers are actually starred. `watchlistOnly` alone cannot say whether the filter
   *  narrows anything — with an empty list it is inert, and counting it claimed otherwise. */
  watchlistCount: number;
  tickerFilter: string;
  directionFilter?: HelixDirectionFilter;
  openingOnly?: boolean;
}): number {
  return (
    (f.minPremium !== HELIX_DEFAULT_MIN_PREMIUM ? 1 : 0) +
    (f.typeFilter !== "ALL" ? 1 : 0) +
    (f.whalesOnly ? 1 : 0) +
    (f.dteFilter !== "all" ? 1 : 0) +
    (f.indicesOnly ? 1 : 0) +
    (watchlistFilterActive(f.watchlistOnly, f.watchlistCount) ? 1 : 0) +
    (f.tickerFilter ? 1 : 0) +
    (f.directionFilter && f.directionFilter !== "all" ? 1 : 0) +
    (f.openingOnly ? 1 : 0)
  );
}

const DENSITY_OPTIONS: { id: HelixTableDensity; label: string }[] = [
  { id: "essential", label: "Lean" },
  { id: "standard", label: "Std" },
  { id: "full", label: "Full" },
];

function ChipToggle({
  active,
  onClick,
  disabled,
  children,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
  tone?: "gold" | "ember" | "sky" | "purple" | "green";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        "helix-tape-chip",
        active && "helix-tape-chip--active",
        tone && `helix-tape-chip--${tone}`
      )}
    >
      {children}
    </button>
  );
}

export function HelixCommandBar({
  minPremium,
  onMinPremiumChange,
  typeFilter,
  onTypeFilterChange,
  callCount,
  putCount,
  allCount,
  tickerFilter,
  onTickerFilterChange,
  whalesOnly,
  onWhalesOnlyChange,
  dteFilter,
  onDteFilterChange,
  indicesOnly,
  onIndicesOnlyChange,
  watchlistOnly,
  onWatchlistOnlyChange,
  watchlistCount,
  analyticsOpen,
  onAnalyticsOpenChange,
  replayMode,
  onReplayToggle,
  replaySpeed,
  onReplaySpeedChange,
  audioEnabled,
  onAudioToggle,
  onExportCsv,
  exportDisabled,
  loading,
  live,
  dataStale,
  displayCount,
  newestAgeLabel,
  replayDisabled,
  directionFilter,
  onDirectionFilterChange,
  openingOnly,
  onOpeningOnlyChange,
  density,
  onDensityChange,
  onApplyPreset,
  onResetFilters,
}: {
  minPremium: number;
  onMinPremiumChange: (v: number) => void;
  typeFilter: HelixTypeFilter;
  onTypeFilterChange: (t: HelixTypeFilter) => void;
  callCount: number;
  putCount: number;
  allCount: number;
  tickerFilter: string;
  onTickerFilterChange: (t: string) => void;
  whalesOnly: boolean;
  onWhalesOnlyChange: (v: boolean) => void;
  dteFilter: HelixDteFilter;
  onDteFilterChange: (v: HelixDteFilter) => void;
  indicesOnly: boolean;
  onIndicesOnlyChange: (v: boolean) => void;
  watchlistOnly: boolean;
  onWatchlistOnlyChange: (v: boolean) => void;
  watchlistCount: number;
  directionFilter: HelixDirectionFilter;
  onDirectionFilterChange: (v: HelixDirectionFilter) => void;
  openingOnly: boolean;
  onOpeningOnlyChange: (v: boolean) => void;
  density: HelixTableDensity;
  onDensityChange: (v: HelixTableDensity) => void;
  onApplyPreset: (presetId: string) => void;
  onResetFilters: () => void;
  analyticsOpen: boolean;
  onAnalyticsOpenChange: (v: boolean) => void;
  replayMode: boolean;
  onReplayToggle: () => void;
  replaySpeed: number;
  onReplaySpeedChange: (s: number) => void;
  audioEnabled: boolean;
  onAudioToggle: () => void;
  onExportCsv: () => void;
  exportDisabled: boolean;
  loading: boolean;
  live: boolean;
  dataStale: boolean;
  displayCount: number;
  newestAgeLabel: string;
  replayDisabled: boolean;
}) {
  const [toolsOpen, setToolsOpen] = useState(false);
  const tickerInputRef = useRef<HTMLInputElement>(null);
  // Mobile web (not the native app) has no room for this desktop filter row — it was
  // rendering as-is, cramped, with no responsive fallback (2026-08-01 Helix audit,
  // ChatGPT Problem 8 / Tier 1 item #7). Below 640px (globals.css, this repo's phone
  // breakpoint) the bar collapses into a trigger + this same content as a bottom sheet.
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);

  const activeFilterCount = countActiveHelixFilters({
    minPremium,
    typeFilter,
    whalesOnly,
    dteFilter,
    indicesOnly,
    watchlistOnly,
    watchlistCount,
    tickerFilter,
    directionFilter,
    openingOnly,
  });

  const presetState = {
    minPremium,
    typeFilter,
    whalesOnly,
    dteFilter,
    indicesOnly,
    directionFilter,
    openingOnly,
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      e.preventDefault();
      tickerInputRef.current?.focus();
      tickerInputRef.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="helix-tape-bar">
      {/* Mobile-only compact trigger — CSS-hidden above --helix-mobile-bp */}
      <button
        type="button"
        onClick={() => setMobileSheetOpen(true)}
        className="helix-tape-mobile-trigger"
        aria-haspopup="dialog"
        aria-expanded={mobileSheetOpen}
      >
        <span
          className={clsx(
            "helix-tape-status-dot",
            !live && "helix-tape-status-dot--off",
            live && dataStale && "helix-tape-status-dot--stale",
            live && !dataStale && "helix-tape-status-dot--live"
          )}
        />
        <span className="helix-tape-mobile-trigger-label">
          Filters{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ""}
        </span>
        <span className="helix-tape-mobile-trigger-meta">
          {loading ? "Scanning…" : `${displayCount.toLocaleString()} · ${newestAgeLabel}`}
        </span>
      </button>

      {mobileSheetOpen && (
        <div
          className="helix-tape-mobile-backdrop"
          onClick={() => setMobileSheetOpen(false)}
          aria-hidden="true"
        />
      )}

      <div
        className={clsx(
          "helix-tape-bar-primary",
          mobileSheetOpen && "helix-tape-bar-primary--sheet-open"
        )}
        role={mobileSheetOpen ? "dialog" : undefined}
        aria-modal={mobileSheetOpen ? true : undefined}
      >
        {mobileSheetOpen && (
          <div className="helix-tape-mobile-sheet-head">
            <span className="helix-tape-mobile-sheet-title">Tape filters</span>
            <button
              type="button"
              onClick={() => setMobileSheetOpen(false)}
              className="helix-tape-mobile-sheet-close"
              aria-label="Close filters"
            >
              Done
            </button>
          </div>
        )}
        <div className="helix-tape-bar-block">
          <span className="helix-tape-bar-label helix-tape-bar-label--cyan">Floor</span>
          <div className="helix-tape-seg helix-tape-seg--floor">
            {HELIX_PREMIUM_PRESETS.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => onMinPremiumChange(v)}
                className={clsx("helix-tape-seg-btn", minPremium === v && "helix-tape-seg-btn--active")}
              >
                {v >= 1_000_000 ? `$${v / 1_000_000}M` : `$${v / 1000}K`}
              </button>
            ))}
          </div>
        </div>

        <div className="helix-tape-bar-block">
          <span className="helix-tape-bar-label">Side</span>
          <div className="helix-tape-seg">
            {(["ALL", "CALL", "PUT"] as HelixTypeFilter[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onTypeFilterChange(t)}
                className={clsx(
                  "helix-tape-seg-btn",
                  typeFilter === t && "helix-tape-seg-btn--active",
                  typeFilter === t && t === "CALL" && "helix-tape-seg-btn--call",
                  typeFilter === t && t === "PUT" && "helix-tape-seg-btn--put"
                )}
              >
                {t}
                <span className="helix-tape-seg-count">
                  {t === "CALL" ? callCount : t === "PUT" ? putCount : allCount}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="helix-tape-bar-block helix-tape-bar-search">
          <label className="helix-tape-bar-label helix-tape-bar-label--green" htmlFor="helix-ticker-search">
            Symbol
          </label>
          <div className="helix-tape-input-wrap">
            <input
              ref={tickerInputRef}
              id="helix-ticker-search"
              value={tickerFilter}
              onChange={(e) => {
                const val = e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6);
                onTickerFilterChange(val);
              }}
              placeholder="SPX"
              aria-label="Filter by ticker"
              maxLength={6}
              className="helix-tape-input"
            />
            <span className="helix-tape-search-hint" aria-hidden="true">
              /
            </span>
            {tickerFilter ? (
              <button
                type="button"
                onClick={() => onTickerFilterChange("")}
                className="helix-tape-input-clear"
                aria-label="Clear ticker filter"
              >
                ×
              </button>
            ) : null}
          </div>
        </div>

        <div className="helix-tape-bar-block helix-tape-bar-chips">
          <span className="helix-tape-bar-label helix-tape-bar-label--purple">Quick</span>
          <div className="helix-tape-chips">
            <ChipToggle active={whalesOnly} onClick={() => onWhalesOnlyChange(!whalesOnly)} tone="purple">
              Whales
            </ChipToggle>
            <ChipToggle
              active={dteFilter === "0dte"}
              onClick={() => onDteFilterChange(dteFilter === "0dte" ? "all" : "0dte")}
              tone="ember"
            >
              0DTE
            </ChipToggle>
            <ChipToggle active={indicesOnly} onClick={() => onIndicesOnlyChange(!indicesOnly)} tone="sky">
              Indices
            </ChipToggle>
            <ChipToggle
              active={watchlistOnly}
              onClick={() => onWatchlistOnlyChange(!watchlistOnly)}
              disabled={watchlistCount === 0}
              tone="gold"
            >
              Watch{watchlistCount > 0 ? ` ${watchlistCount}` : ""}
            </ChipToggle>
            <ChipToggle
              active={openingOnly}
              onClick={() => onOpeningOnlyChange(!openingOnly)}
              tone="gold"
            >
              New OI
            </ChipToggle>
          </div>
        </div>

        <div className="helix-tape-bar-block helix-tape-bar-chips">
          <span className="helix-tape-bar-label helix-tape-bar-label--green">Read</span>
          <div className="helix-tape-chips">
            {(["all", "bullish", "bearish"] as HelixDirectionFilter[]).map((d) => (
              <ChipToggle
                key={d}
                active={directionFilter === d}
                onClick={() => onDirectionFilterChange(d)}
                tone={d === "bullish" ? "green" : d === "bearish" ? "ember" : undefined}
              >
                {d === "all" ? "Any dir" : d === "bullish" ? "Bull" : "Bear"}
              </ChipToggle>
            ))}
          </div>
        </div>

        <div className="helix-tape-bar-spacer" />

        <div className="helix-tape-bar-block">
          <span className="helix-tape-bar-label helix-tape-bar-label--amber">DTE</span>
          <div className="helix-tape-seg helix-tape-seg--compact helix-tape-seg--dte">
            {DTE_OPTIONS.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => onDteFilterChange(o.id)}
                className={clsx(
                  "helix-tape-seg-btn helix-tape-seg-btn--compact",
                  dteFilter === o.id && "helix-tape-seg-btn--active"
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div className="helix-tape-bar-block">
          <span className="helix-tape-bar-label">Cols</span>
          <div className="helix-tape-seg helix-tape-seg--compact">
            {DENSITY_OPTIONS.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => onDensityChange(o.id)}
                className={clsx(
                  "helix-tape-seg-btn helix-tape-seg-btn--compact",
                  density === o.id && "helix-tape-seg-btn--active"
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => onAnalyticsOpenChange(!analyticsOpen)}
          className={clsx("helix-tape-tool-btn", analyticsOpen && "helix-tape-tool-btn--active")}
          aria-pressed={analyticsOpen}
        >
          {analyticsOpen ? "Hide analytics" : "Analytics"}
        </button>

        <button
          type="button"
          onClick={() => setToolsOpen((v) => !v)}
          className={clsx("helix-tape-tool-btn", toolsOpen && "helix-tape-tool-btn--active")}
          aria-expanded={toolsOpen}
        >
          Tools
        </button>

        <div className="helix-tape-status" aria-live="polite">
          <span
            className={clsx(
              "helix-tape-status-dot",
              !live && "helix-tape-status-dot--off",
              live && dataStale && "helix-tape-status-dot--stale",
              live && !dataStale && "helix-tape-status-dot--live"
            )}
          />
          <div className="helix-tape-status-copy">
            <span className="helix-tape-status-label">
              {!live ? "Offline" : dataStale ? "Stale" : "Live"}
            </span>
            <span className="helix-tape-status-meta">
              {loading ? "Scanning…" : `${displayCount.toLocaleString()} · ${newestAgeLabel}`}
            </span>
          </div>
        </div>
      </div>

      <div className="helix-tape-presets">
        <span className="helix-tape-bar-label">Presets</span>
        <div className="helix-tape-chips">
          {HELIX_FILTER_PRESETS.map((preset) => (
            <ChipToggle
              key={preset.id}
              active={helixPresetMatches(preset, presetState)}
              onClick={() => onApplyPreset(preset.id)}
              tone={preset.tone}
            >
              {preset.label}
            </ChipToggle>
          ))}
          {activeFilterCount > 0 ? (
            <button type="button" onClick={onResetFilters} className="helix-tape-preset-reset">
              Reset
            </button>
          ) : null}
        </div>
      </div>

      <AnimatePresence initial={false}>
        {toolsOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="helix-tape-bar-tools overflow-hidden"
          >
            <button
              type="button"
              onClick={onReplayToggle}
              disabled={replayDisabled}
              className={clsx("helix-tape-tool-btn", replayMode && "helix-tape-tool-btn--active")}
            >
              {replayMode ? "Stop replay" : "Replay"}
            </button>
            {replayMode &&
              [0.5, 1, 2].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onReplaySpeedChange(s)}
                  className={clsx("helix-tape-tool-btn", replaySpeed === s && "helix-tape-tool-btn--active")}
                >
                  {s}×
                </button>
              ))}
            <button
              type="button"
              onClick={onAudioToggle}
              className={clsx("helix-tape-tool-btn", audioEnabled && "helix-tape-tool-btn--active")}
            >
              {audioEnabled ? "Audio on" : "Audio"}
            </button>
            <button
              type="button"
              onClick={onExportCsv}
              disabled={exportDisabled}
              className="helix-tape-tool-btn"
            >
              Export CSV
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
