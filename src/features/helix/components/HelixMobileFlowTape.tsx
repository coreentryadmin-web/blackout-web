"use client";

import { useMemo, useRef } from "react";
import { clsx } from "clsx";
import type { FlowAlert } from "@/lib/api";
import { fmtPremium } from "@/lib/api";
import { EmptyState, Skeleton } from "@/components/ui";
import {
  daysToExpiry,
  flowSignals,
  fmtExpiryShort,
  sortFlows,
} from "@/features/helix/lib/helix-flow-format";
import { tapeTimeDisplay } from "@/features/helix/lib/helix-tape-time";
import {
  WHALE_PRINT_PREMIUM,
} from "@/features/helix/lib/helix-flow-limits";


// Real mobile-web tape layout (2026-08-02 Helix audit, Tier 1 item #8). Mobile web (and the
// native iOS shell — both go through useCompactDeskPanels) previously rendered the SAME
// desktop CSS-grid table (`HelixFlowTable`) as a wide desk viewport, forcing horizontal
// scroll on a phone. This is a card-per-print layout sized for a single narrow column,
// reusing the desktop table's OWN `flowSignals()` badge computation (not a re-derived
// duplicate set — the two views cannot drift into showing different badges for the same
// print) and the same server-cursor pagination props (`hasMorePages`/`onLoadOlder`), not the
// old deleted FlowAlertStream's client-side 150-card render-limit slicing.
function SkeletonCards() {
  return (
    <div className="flex flex-col gap-2 px-1 py-2">
      {[80, 65, 90, 55, 75].map((w, i) => (
        <div key={i} className="rounded-lg border border-white/10 px-4 py-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Skeleton width={w * 0.6} height={18} rounded="sm" />
              <Skeleton width={40} height={14} rounded="sm" />
            </div>
            <Skeleton width={64} height={16} rounded="sm" />
          </div>
          <Skeleton width={`${w}%`} height={11} rounded="sm" />
        </div>
      ))}
    </div>
  );
}

export function HelixMobileFlowTape({
  flows,
  live,
  loading,
  typeFilter = "ALL",
  tickerFilter,
  hasData = false,
  compoundTickers,
  onTickerClick,
  onContractClick,
  replayMode = false,
  splitFlowTickers,
  earningsDays,
  velocitySpikeTickers,
  coordinatedTickers,
  hawkTickers,
  watchlistTickers,
  onToggleStar,
  hasMorePages = false,
  loadingOlder = false,
  autoBackfilling = false,
  onLoadOlder,
}: {
  flows: FlowAlert[];
  live?: boolean;
  loading?: boolean;
  typeFilter?: "ALL" | "CALL" | "PUT";
  tickerFilter?: string;
  hasData?: boolean;
  compoundTickers?: Set<string>;
  onTickerClick?: (ticker: string) => void;
  onContractClick?: (flow: FlowAlert) => void;
  replayMode?: boolean;
  splitFlowTickers?: Set<string>;
  earningsDays?: Record<string, number>;
  velocitySpikeTickers?: Set<string>;
  coordinatedTickers?: Set<string>;
  hawkTickers?: Set<string>;
  watchlistTickers?: Set<string>;
  onToggleStar?: (ticker: string) => void;
  hasMorePages?: boolean;
  loadingOlder?: boolean;
  autoBackfilling?: boolean;
  onLoadOlder?: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const typed = useMemo(
    () =>
      flows.filter((f) => {
        const t = f.option_type?.toUpperCase();
        return t === "CALL" || t === "PUT";
      }),
    [flows]
  );

  const visible = useMemo(() => {
    const base = typeFilter === "ALL" ? typed : typed.filter((f) => f.option_type?.toUpperCase() === typeFilter);
    return sortFlows(base, "time", "desc");
  }, [typed, typeFilter]);

  const feedDown = !loading && !replayMode && !live;

  return (
    <div className="helix-tape desk-panel flex flex-1 flex-col min-h-0">
      {feedDown && (
        <div className="helix-tape-alert" role="alert">
          Feed unavailable — retrying in background
        </div>
      )}

      <div ref={scrollRef} className="helix-tape-scroll flow-scroll" role="log" aria-live="polite" aria-label="Live options flow tape">
        {loading ? (
          <SkeletonCards />
        ) : visible.length === 0 ? (
          <EmptyState
            className="!border-transparent !bg-transparent !py-16"
            title={
              tickerFilter
                ? `No prints for ${tickerFilter}`
                : typeFilter !== "ALL"
                  ? `No ${typeFilter} prints`
                  : "Watching the tape"
            }
            description={
              hasData
                ? "Filters are active — widen floor or clear symbol to see more."
                : live
                  ? "Acquiring flow…"
                  : "Reconnecting…"
            }
          />
        ) : (
          <div className="flex flex-col gap-1.5 px-1 py-2">
            {visible.map((flow, i) => {
              const isCall = flow.option_type?.toUpperCase() === "CALL";
              const isWhale = flow.premium >= WHALE_PRINT_PREMIUM;
              const dte = flow.dte ?? daysToExpiry(flow.expiry);
              const is0dte = dte === 0;
              const isCompound = compoundTickers?.has(flow.ticker) ?? false;
              const earnIn = earningsDays?.[flow.ticker] ?? null;
              const signals = flowSignals(flow, {
                isWhale,
                isCompound,
                is0dte,
                hasSplit: splitFlowTickers?.has(flow.ticker),
                hasVelocity: velocitySpikeTickers?.has(flow.ticker),
                hasCoord: coordinatedTickers?.has(flow.ticker),
                isHawk: hawkTickers?.has(flow.ticker),
                earnIn,
              });
              const isStarred = watchlistTickers?.has(flow.ticker) ?? false;
              const isNew = i === 0;
              const interactive = Boolean(onContractClick || onTickerClick);

              const cardCls = clsx(
                "flow-card",
                isCompound ? "flow-card-compound" : isCall ? "flow-card-call" : "flow-card-put"
              );

              return (
                <div
                  key={`${flow.ticker}-${flow.alerted_at}-${flow.strike}-${i}`}
                  onClick={() => {
                    if (onContractClick) onContractClick(flow);
                    else onTickerClick?.(flow.ticker);
                  }}
                  onKeyDown={
                    interactive
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            if (onContractClick) onContractClick(flow);
                            else onTickerClick?.(flow.ticker);
                          }
                        }
                      : undefined
                  }
                  role={interactive ? "button" : undefined}
                  tabIndex={interactive ? 0 : undefined}
                  aria-label={interactive ? `Open ${flow.ticker} flow detail` : undefined}
                  className={cardCls}
                  style={isNew ? { animation: "flow-alert-flash 2s ease-out forwards" } : undefined}
                >
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      {onToggleStar && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleStar(flow.ticker);
                          }}
                          title={isStarred ? `Remove ${flow.ticker} from watchlist` : `Add ${flow.ticker} to watchlist`}
                          aria-pressed={isStarred}
                          className={clsx(
                            "tap44 leading-none text-[14px] transition-colors",
                            isStarred ? "text-gold" : "text-cyan-400 hover:text-gold"
                          )}
                        >
                          {isStarred ? "★" : "☆"}
                        </button>
                      )}
                      <span className="font-anton text-[20px] leading-none text-gold tracking-wide">
                        {flow.ticker}
                      </span>
                      <span className={clsx("font-mono text-[11px] font-bold", isCall ? "text-bull" : "text-bear-text")}>
                        {flow.option_type?.toUpperCase()}
                      </span>
                      {signals.map((s) => (
                        <span
                          key={s.id}
                          className={clsx("helix-tape-signal", `helix-tape-signal--${s.tone}`)}
                          title={s.label}
                        >
                          {s.label}
                        </span>
                      ))}
                    </div>
                    <span
                      className={clsx(
                        "t-num text-[16px] font-bold tabular-nums tracking-tight shrink-0",
                        isCompound ? "text-gold" : isCall ? "text-bull" : "text-bear-text"
                      )}
                    >
                      {fmtPremium(flow.premium)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between mt-1.5 gap-2">
                    <p className="font-mono text-[11px] text-sky-300 leading-none flex items-center gap-1 flex-wrap">
                      <span className="text-gold font-semibold">
                        {flow.strike}
                        {isCall ? "C" : "P"}
                      </span>
                      <span className="text-cyan-400">·</span>
                      <span>{fmtExpiryShort(flow.expiry)}</span>
                      {!is0dte && (
                        <>
                          <span className="text-cyan-400">·</span>
                          <span>{dte}d</span>
                        </>
                      )}
                    </p>
                    <span className="flex items-center gap-2 shrink-0">
                      {flow.score > 0 && (
                        <span
                          className={clsx(
                            "font-mono text-[10px] font-medium",
                            flow.score >= 8 ? "text-purple-light" : flow.score >= 6 ? "text-purple" : "text-cyan-400"
                          )}
                        >
                          ▲{flow.score.toFixed(1)}
                        </span>
                      )}
                      {/* PRINT TIME. This card previously rendered NONE — not an unmarked one, none
                          at all — so a member could not tell whether the top card was thirty seconds
                          or thirty-five hours old, on a tape whose default window is 168h. Compact
                          age here because the card is dense; the exact ET stamp rides in `title`,
                          and the `~` marks an ingest estimate visibly, since a tooltip is
                          unreachable on touch. Shared with the desktop tape. */}
                      {(() => {
                        const t = tapeTimeDisplay(flow, { compact: true });
                        return (
                          <span
                            className={clsx(
                              "font-mono text-[10px] tabular-nums",
                              t.estimated ? "helix-tape-time--estimated" : "text-sky-300/70"
                            )}
                            title={t.title}
                          >
                            {t.label}
                          </span>
                        );
                      })()}
                    </span>
                  </div>
                </div>
              );
            })}

            {hasMorePages && onLoadOlder && (
              <button
                type="button"
                className="helix-tape-load-more"
                disabled={loadingOlder}
                onClick={onLoadOlder}
              >
                {loadingOlder ? (autoBackfilling ? "Loading matching history…" : "Loading…") : "Load older"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
