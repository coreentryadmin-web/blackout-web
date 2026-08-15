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
  type HelixFlowSortDir,
  type HelixFlowSortKey,
} from "@/features/helix/lib/helix-flow-format";
import { useVectorHelixFlows } from "@/features/vector/lib/use-vector-helix-flows";
import {
  filterVectorHelixFlows,
  sortVectorHelixFlows,
  VECTOR_HELIX_DEFAULT_FILTERS,
  VECTOR_HELIX_WHALE_PREMIUM,
  type VectorHelixFlowFilters,
  type VectorHelixTypeFilter,
} from "@/features/vector/lib/vector-helix-flows";

const SORT_OPTIONS: { key: HelixFlowSortKey; label: string }[] = [
  { key: "premium", label: "Premium" },
  { key: "time", label: "Time" },
  { key: "strike", label: "Strike" },
  { key: "score", label: "Score" },
  { key: "dte", label: "DTE" },
];

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
  isNew,
  onOpen,
}: {
  flow: FlowAlert;
  isNew: boolean;
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
        isNew && "vector-helix-card--flash"
      )}
      onClick={() => onOpen(flow)}
      data-testid="vector-helix-flow-card"
    >
      <div className="vector-helix-card-top">
        <div className="vector-helix-card-contract">
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
          {signals.slice(0, 3).map((s) => (
            <SignalPill key={s.id} label={s.label} tone={s.tone} />
          ))}
        </div>
      </div>
    </button>
  );
}

export function VectorHelixRail({ ticker, liveSession }: Props) {
  const normalized = ticker.trim().toUpperCase();
  const { flows, loading, loadingOlder, live, hasMore, loadOlder } = useVectorHelixFlows(
    normalized,
    liveSession
  );

  const [sortKey, setSortKey] = useState<HelixFlowSortKey>("premium");
  const [sortDir, setSortDir] = useState<HelixFlowSortDir>("desc");
  const [filters, setFilters] = useState<VectorHelixFlowFilters>(VECTOR_HELIX_DEFAULT_FILTERS);
  const [selected, setSelected] = useState<FlowAlert | null>(null);

  const visible = useMemo(() => {
    const filtered = filterVectorHelixFlows(flows, filters);
    return sortVectorHelixFlows(filtered, sortKey, sortDir);
  }, [flows, filters, sortKey, sortDir]);

  const toggleSort = (key: HelixFlowSortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
      return;
    }
    setSortKey(key);
    setSortDir(key === "time" ? "desc" : "desc");
  };

  const setTypeFilter = (typeFilter: VectorHelixTypeFilter) => {
    setFilters((f) => ({ ...f, typeFilter }));
  };

  return (
    <section className="vector-helix-rail" aria-label={`${normalized} Helix flow tape`}>
      <header className="vector-helix-head">
        <div className="vector-helix-head-row">
          <div>
            <p className="vector-helix-kicker">Helix</p>
            <h2 className="vector-helix-title">{normalized} flows</h2>
          </div>
          <FreshnessChip status={liveSession && live ? "live" : "stale"} label={live ? "LIVE" : "STALE"} />
        </div>
        <Link
          href={`/flows?ticker=${encodeURIComponent(normalized)}`}
          className="vector-helix-open-full"
          data-testid="vector-helix-open-full"
        >
          Open full tape →
        </Link>
      </header>

      <div className="vector-helix-controls">
        <div className="vector-helix-sort" role="group" aria-label="Sort flows">
          {SORT_OPTIONS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className={clsx("vector-helix-sort-btn", sortKey === key && "is-active")}
              aria-pressed={sortKey === key}
              onClick={() => toggleSort(key)}
            >
              {label}
              {sortKey === key ? (
                <span className="vector-helix-sort-dir" aria-hidden>
                  {sortDir === "desc" ? "↓" : "↑"}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        <div className="vector-helix-filters" role="group" aria-label="Filter flows">
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
          <button
            type="button"
            className={clsx("vector-helix-filter-btn", filters.whalesOnly && "is-active")}
            aria-pressed={filters.whalesOnly}
            onClick={() => setFilters((f) => ({ ...f, whalesOnly: !f.whalesOnly }))}
          >
            Whales
          </button>
          <button
            type="button"
            className={clsx("vector-helix-filter-btn", filters.dteOnly && "is-active")}
            aria-pressed={filters.dteOnly}
            onClick={() => setFilters((f) => ({ ...f, dteOnly: !f.dteOnly }))}
          >
            0DTE
          </button>
        </div>
      </div>

      <div className="vector-helix-scroll" role="log" aria-live="polite">
        {loading && visible.length === 0 ? (
          <p className="vector-helix-empty">Loading Helix tape…</p>
        ) : visible.length === 0 ? (
          <p className="vector-helix-empty">No qualifying prints for {normalized}</p>
        ) : (
          <div className="vector-helix-cards">
            {visible.map((flow, i) => (
              <FlowCard
                key={`${flow.alert_id ?? flow.alerted_at}-${flow.strike}-${i}`}
                flow={flow}
                isNew={i === 0 && sortKey === "time" && sortDir === "desc"}
                onOpen={setSelected}
              />
            ))}
            {hasMore ? (
              <button
                type="button"
                className="vector-helix-load-more"
                disabled={loadingOlder}
                onClick={() => void loadOlder()}
              >
                {loadingOlder ? "Loading…" : "Load older"}
              </button>
            ) : null}
          </div>
        )}
      </div>

      <ContractDrilldownDrawer flow={selected} onClose={() => setSelected(null)} />
    </section>
  );
}
