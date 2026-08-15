"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import clsx from "clsx";
import type { FlowAlert } from "@/lib/api";
import { fmtPremium } from "@/lib/api";
import { FreshnessChip } from "@/components/ui";
import { ContractDrilldownDrawer } from "@/features/helix/components/ContractDrilldownDrawer";
import {
  daysToExpiry,
  flowSignals,
  fmtExpiryShort,
  fmtFullTimestamp,
} from "@/features/helix/lib/helix-flow-format";
import { flowDedupeKey } from "@/features/helix/lib/helix-flow-tape-merge";
import { useVectorHelixFlows } from "@/features/vector/lib/use-vector-helix-flows";
import {
  pickVectorHelixSessionFlows,
  VECTOR_HELIX_DEFAULT_FILTERS,
  VECTOR_HELIX_HOT_WINDOW_MIN,
  VECTOR_HELIX_WHALE_PREMIUM,
  vectorHelixSessionSubtitle,
  type VectorHelixFlowFilters,
  type VectorHelixTypeFilter,
} from "@/features/vector/lib/vector-helix-flows";

type Props = {
  ticker: string;
  liveSession: boolean;
};

function SignalPill({ label, tone }: { label: string; tone: string }) {
  return (
    <span className={clsx("helix-tape-signal", `helix-tape-signal--${tone}`)} title={label}>
      {label}
    </span>
  );
}

function FlowCard({
  flow,
  rank,
  badge,
  flash,
  onOpen,
}: {
  flow: FlowAlert;
  rank?: number;
  badge?: string;
  flash?: boolean;
  onOpen: (flow: FlowAlert) => void;
}) {
  const isCall = flow.option_type?.toUpperCase() === "CALL";
  const isWhale = flow.premium >= VECTOR_HELIX_WHALE_PREMIUM;
  const dte = flow.dte ?? daysToExpiry(flow.expiry);
  const is0dte = dte === 0;
  const signals = flowSignals(flow, { isWhale, is0dte });

  return (
    <button
      type="button"
      className={clsx(
        "vector-helix-card",
        isCall ? "vector-helix-card--call" : "vector-helix-card--put",
        isWhale && "vector-helix-card--whale",
        rank === 1 && "vector-helix-card--lead",
        flash && "vector-helix-card--flash"
      )}
      onClick={() => onOpen(flow)}
      data-testid="vector-helix-flow-card"
    >
      <div className="vector-helix-card-top">
        <div className="vector-helix-card-contract">
          {badge ? (
            <span className="vector-helix-badge vector-helix-badge--hot" aria-hidden>
              {badge}
            </span>
          ) : rank != null ? (
            <span className="vector-helix-rank" aria-hidden>
              #{rank}
            </span>
          ) : null}
          <span className={clsx("vector-helix-side", isCall ? "is-call" : "is-put")}>
            {isCall ? "CALL" : "PUT"}
          </span>
          <span className="vector-helix-strike">
            {flow.strike}
            {isCall ? "C" : "P"}
          </span>
          <span className="vector-helix-exp">{fmtExpiryShort(flow.expiry)}</span>
          {!is0dte ? <span className="vector-helix-dte">{dte}d</span> : <span className="vector-helix-dte is-0dte">0DTE</span>}
        </div>
        <span className={clsx("vector-helix-premium", isCall ? "is-call" : "is-put")}>
          {fmtPremium(flow.premium)}
        </span>
      </div>
      <div className="vector-helix-card-meta">
        <span className="vector-helix-time">{fmtFullTimestamp(flow.alerted_at)}</span>
        <div className="vector-helix-signals">
          {flow.score > 0 ? (
            <span className={clsx("vector-helix-score", flow.score >= 8 && "is-high")}>
              ▲{flow.score.toFixed(1)}
            </span>
          ) : null}
          {isWhale ? <SignalPill label="WHALE" tone="gold" /> : null}
          {signals.slice(0, 2).map((s) => (
            <SignalPill key={s.id} label={s.label} tone={s.tone} />
          ))}
        </div>
      </div>
    </button>
  );
}

/** Vector desk — session Helix: hot recent prints + top-by-premium leaders. */
export function VectorHelixRail({ ticker, liveSession }: Props) {
  const normalized = ticker.trim().toUpperCase();
  const { flows, loading, live, flashKeys } = useVectorHelixFlows(normalized, liveSession);

  const [filters, setFilters] = useState<VectorHelixFlowFilters>(VECTOR_HELIX_DEFAULT_FILTERS);
  const [selected, setSelected] = useState<FlowAlert | null>(null);

  const sessionPick = useMemo(
    () => pickVectorHelixSessionFlows(flows, filters),
    [flows, filters]
  );
  const { hotNow, sessionLeaders } = sessionPick;
  const subtitle = vectorHelixSessionSubtitle(sessionPick);
  const hasAny = hotNow.length > 0 || sessionLeaders.length > 0;

  const setTypeFilter = (typeFilter: VectorHelixTypeFilter) => {
    setFilters((f) => ({ ...f, typeFilter }));
  };

  const cardKey = (flow: FlowAlert, i: number) =>
    `${flow.alert_id ?? flow.alerted_at}-${flow.strike}-${i}`;

  return (
    <section className="vector-helix-rail" aria-label={`${normalized} session flow prints`}>
      <header className="vector-helix-head">
        <div className="vector-helix-head-row">
          <div>
            <p className="vector-helix-kicker">Helix</p>
            <h2 className="vector-helix-title">{normalized} session flows</h2>
            <p className="vector-helix-subtitle">{subtitle}</p>
          </div>
          <FreshnessChip status={liveSession && live ? "live" : "stale"} label={live ? "LIVE" : "STALE"} />
        </div>
        <Link
          href={`/flows?ticker=${encodeURIComponent(normalized)}`}
          className="vector-helix-open-full"
          data-testid="vector-helix-open-full"
        >
          Full Helix tape →
        </Link>
      </header>

      <div className="vector-helix-controls vector-helix-controls--major">
        <div className="vector-helix-filters" role="group" aria-label="Filter session flows">
          {(["ALL", "CALL", "PUT"] as const).map((side) => (
            <button
              key={side}
              type="button"
              className={clsx("vector-helix-filter-btn", filters.typeFilter === side && "is-active")}
              aria-pressed={filters.typeFilter === side}
              onClick={() => setTypeFilter(side)}
            >
              {side}
            </button>
          ))}
        </div>
      </div>

      <div className="vector-helix-scroll" role="log" aria-live="polite">
        {loading && !hasAny ? (
          <p className="vector-helix-empty">Loading session flows…</p>
        ) : !hasAny ? (
          <p className="vector-helix-empty">No session flows for {normalized} yet</p>
        ) : (
          <div className="vector-helix-sections">
            {hotNow.length > 0 ? (
              <div className="vector-helix-section" data-testid="vector-helix-hot-section">
                <h3 className="vector-helix-section-title">Hot now</h3>
                <p className="vector-helix-section-kicker">Last {VECTOR_HELIX_HOT_WINDOW_MIN}m · by premium</p>
                <div className="vector-helix-cards">
                  {hotNow.map((flow, i) => (
                    <FlowCard
                      key={cardKey(flow, i)}
                      flow={flow}
                      badge="NOW"
                      flash={flashKeys.has(flowDedupeKey(flow))}
                      onOpen={setSelected}
                    />
                  ))}
                </div>
              </div>
            ) : null}

            {sessionLeaders.length > 0 ? (
              <div className="vector-helix-section" data-testid="vector-helix-leaders-section">
                <h3 className="vector-helix-section-title">Top by premium</h3>
                <p className="vector-helix-section-kicker">Session leaders</p>
                <div className="vector-helix-cards">
                  {sessionLeaders.map((flow, i) => (
                    <FlowCard
                      key={cardKey(flow, i)}
                      flow={flow}
                      rank={i + 1}
                      flash={flashKeys.has(flowDedupeKey(flow))}
                      onOpen={setSelected}
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>

      <ContractDrilldownDrawer flow={selected} onClose={() => setSelected(null)} />
    </section>
  );
}
