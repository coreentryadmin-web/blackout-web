"use client";

import { useState } from "react";
import clsx from "clsx";
import { Drawer } from "@/components/ui";
import type { VectorContractPick, VectorPickEvidenceSection } from "@/lib/api";
import type { VectorPlay } from "@/features/vector/lib/vector-play-engine";
import { partitionPickEvidence } from "@/features/vector/lib/vector-pick-evidence-rails";
import { formatPickPremiumDriftPct, formatPickPremiumRange } from "@/features/vector/lib/vector-pick-live-status";
import { pivotPickWaitingCopy } from "@/features/vector/lib/vector-pick-effective-bias";

type Props = {
  ticker: string;
  play: VectorPlay | null;
  picks: VectorContractPick[];
  /** Invalidated picks — shown below active slots with Don't buy status. */
  closedPicks?: VectorContractPick[];
  loading: boolean;
  /** Spot + flip for pivot plays — ranks PLYS once spot commits past the flip. */
  spot?: number | null;
  gammaFlip?: number | null;
  /** Session replay — last pick frame stays visible; live quotes do not refresh. */
  replayPaused?: boolean;
  className?: string;
};

type DrawerRail = "option" | "desk";

const CAVEAT_TEXT: Record<NonNullable<VectorContractPick["caveat"]>, string> = {
  premium_high: "Premium above the standard cap — verify size.",
  low_liquidity: "Thin open interest — use a limit order.",
  premium_high_low_liquidity: "Premium above cap and thin open interest — verify size and use a limit order.",
};

const ACTION_LABEL: Record<NonNullable<VectorContractPick["actionStatus"]>, string> = {
  still_buy: "Still buy",
  caution: "Caution",
  dont_buy: "Don't buy",
};

function actionClass(status: VectorContractPick["actionStatus"]): string {
  if (status === "still_buy") return "vector-pick-action-still-buy";
  if (status === "dont_buy") return "vector-pick-action-dont-buy";
  return "vector-pick-action-caution";
}

const ROLE_LABEL: Record<string, string> = {
  "primary-long": "Primary long",
  "primary-short": "Primary short",
  "fade-dip": "Range fade — buy dip",
  "fade-rip": "Range fade — sell rip",
  "flow-whale": "HELIX whale anchor",
  "gex-king-pin": "GEX king pin",
  "magnet-mean": "Magnet mean",
};

function sideActionLabel(side: "call" | "put"): string {
  return side === "call" ? "Buy call to open" : "Buy put to open";
}

// Institutional section codes — scannable without emoji (member: professional play-engine UI).
const SECTION_CODE: Record<VectorPickEvidenceSection["id"], string> = {
  strike: "STR",
  flow: "FLW",
  positioning: "POS",
  structure: "STC",
  technicals: "TEC",
  liquidity: "LIQ",
  session: "SES",
  gex: "GEX",
  catalyst: "CAT",
};

const SECTION_ACCENT: Record<VectorPickEvidenceSection["id"], string> = {
  strike: "sky",
  flow: "violet",
  positioning: "blue",
  structure: "slate",
  technicals: "teal",
  liquidity: "cyan",
  session: "amber",
  gex: "emerald",
  catalyst: "orange",
};

function EvidenceBlock({ section }: { section: VectorPickEvidenceSection }) {
  const accent = SECTION_ACCENT[section.id];
  return (
    <section className={clsx("vector-pick-evidence-section", `vector-pick-evidence-section--${accent}`)}>
      <h3 className="vector-pick-evidence-title">
        <span className="vector-pick-evidence-code" aria-hidden="true">
          {SECTION_CODE[section.id]}
        </span>
        {section.title}
      </h3>
      <dl className="vector-pick-evidence-list">
        {section.items.map((item) => (
          <div key={`${section.id}-${item.label}-${item.value}`} className="vector-pick-evidence-row">
            <dt>{item.label}</dt>
            <dd>
              <span className="vector-pick-evidence-value">{item.value}</span>
              {item.detail ? <span className="vector-pick-evidence-detail">{item.detail}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function EvidenceRail({
  sections,
  emptyLabel,
}: {
  sections: VectorPickEvidenceSection[];
  emptyLabel: string;
}) {
  if (!sections.length) {
    return <p className="vector-pick-rail-empty">{emptyLabel}</p>;
  }
  return (
    <div className="vector-pick-evidence-stack">
      {sections.map((section) => (
        <EvidenceBlock key={section.id} section={section} />
      ))}
    </div>
  );
}

/**
 * Ranked 1–3 buy-to-open contract ideas. Drawer splits justification into Option play (execution)
 * vs Desk data (HELIX, Thermal, catalysts, chart context).
 */
export function VectorContractPicksCard({
  ticker,
  play,
  picks,
  closedPicks = [],
  loading,
  spot = null,
  gammaFlip = null,
  replayPaused = false,
  className,
}: Props) {
  const [openPick, setOpenPick] = useState<VectorContractPick | null>(null);
  const [rail, setRail] = useState<DrawerRail>("desk");

  const renderPickRow = (pick: VectorContractPick, i: number, opts?: { closed?: boolean }) => {
    const liveRange =
      formatPickPremiumRange(pick.liveBid ?? null, pick.liveAsk ?? null, pick.liveMid ?? null) ??
      formatPickPremiumRange(pick.entryBid ?? null, pick.entryAsk ?? null, pick.entryMid ?? pick.premium);
    const driftPct = formatPickPremiumDriftPct(pick.premiumPctFromEntry);
    return (
      <button
        key={`${pick.side}-${pick.strike}-${pick.expiry}-${opts?.closed ? "closed" : "active"}`}
        type="button"
        className={clsx("vector-contract-pick-row", opts?.closed && "vector-contract-pick-row-closed")}
        onClick={() => {
          setOpenPick(pick);
          setRail("desk");
        }}
      >
        <span className="vector-contract-pick-rank">{pick.rank ?? i + 1}.</span>
        <span className="vector-contract-pick-main">
          <span
            className={clsx(
              "vector-contract-pick-label",
              pick.side === "call" ? "vector-contract-pick-call" : "vector-contract-pick-put"
            )}
          >
            {pick.label}
            {pick.dte != null && pick.dte > 0 ? (
              <span className="vector-contract-pick-dte"> · {pick.dte}D</span>
            ) : pick.dte === 0 ? (
              <span className="vector-contract-pick-dte"> · 0DTE</span>
            ) : null}
          </span>
          {liveRange || driftPct ? (
            <span className="vector-contract-pick-premium-row">
              {liveRange ? <span className="vector-contract-pick-premium">{liveRange}</span> : null}
              {driftPct ? (
                <span
                  className={clsx(
                    "vector-contract-pick-drift",
                    (pick.premiumPctFromEntry ?? 0) >= 0
                      ? "vector-contract-pick-drift-up"
                      : "vector-contract-pick-drift-down"
                  )}
                >
                  {driftPct}
                </span>
              ) : null}
            </span>
          ) : null}
        </span>
        {pick.actionStatus ? (
          <span className={clsx("vector-pick-action-chip", actionClass(pick.actionStatus))}>
            {ACTION_LABEL[pick.actionStatus]}
          </span>
        ) : null}
        {pick.liveQuotesStale && !replayPaused ? (
          <span
            className="vector-play-card-stale"
            title="Live quote feed hasn't updated recently — bid/ask/status shown are the last known-good read"
          >
            STALE
          </span>
        ) : null}
        {!opts?.closed && (pick.rank ?? i + 1) === 1 && !pick.actionStatus ? (
          <span className="vector-contract-pick-primary-tag">Primary</span>
        ) : null}
      </button>
    );
  };

  if (!picks.length && !closedPicks.length) {
    // A directional play with zero picks is a real, member-relevant state (every candidate
    // contract missed the quality/liquidity bar) — distinct from "still fetching" and from "no
    // directional play exists at all" (neutral bias / no play yet), neither of which needs a card.
    if (loading) {
      return (
        <div className={clsx("vp-intel vector-contract-picks-card", className)}>
          <div className="vp-intel-card">
            <div className="vp-intel-card-head">
              <span className="vp-intel-card-code">PLYS</span>
              <span className="vp-intel-card-title">{ticker} PLAYS · loading</span>
            </div>
            <p className="vector-contract-picks-empty">Scanning the chain for a contract worth showing…</p>
          </div>
        </div>
      );
    }
    if (play && play.bias !== "neutral") {
      return (
        <div className={clsx("vp-intel vector-contract-picks-card", className)}>
          <div className="vp-intel-card">
            <div className="vp-intel-card-head">
              <span className="vp-intel-card-code">PLYS</span>
              <span className="vp-intel-card-title">{ticker} PLAYS</span>
            </div>
            <p className="vector-contract-picks-empty">
              No contract in the chain cleared our setup-quality bar for this play right now.
            </p>
          </div>
        </div>
      );
    }
    const pivotWait = play ? pivotPickWaitingCopy(play, gammaFlip) : null;
    if (play && pivotWait) {
      return (
        <div className={clsx("vp-intel vector-contract-picks-card", className)}>
          <div className="vp-intel-card">
            <div className="vp-intel-card-head">
              <span className="vp-intel-card-code">PLYS</span>
              <span className="vp-intel-card-title">{ticker} PLAYS · pivot</span>
            </div>
            <p className="vector-contract-picks-empty">{pivotWait}</p>
          </div>
        </div>
      );
    }
    return null;
  }
  const open = openPick;
  const partitioned = open?.evidence?.length ? partitionPickEvidence(open.evidence) : null;

  return (
    <div className={clsx("vp-intel vector-contract-picks-card", className)}>
      <div className="vp-intel-card">
        <div className="vp-intel-card-head">
          <span className="vp-intel-card-code">PLYS</span>
          <span className="vp-intel-card-title">
            {ticker} PLAYS
            {play ? ` · ${play.conviction}% play` : ""}
            {loading && !replayPaused ? " · updating" : ""}
            {replayPaused ? " · replay" : ""}
          </span>
        </div>
        {picks.length ? (
          <>
            <p className="vector-contract-picks-sub">Buy-to-open contracts · ranked by setup quality</p>
            <div className="vector-contract-picks-list">{picks.map((pick, i) => renderPickRow(pick, i))}</div>
          </>
        ) : (
          <p className="vector-contract-picks-empty">
            No active contract cleared the bar — watching for a fresh rank after invalidations.
          </p>
        )}
        {closedPicks.length ? (
          <>
            <p className="vector-contract-picks-sub vector-contract-picks-sub-closed">
              Closed · setup invalidated or no longer buyable
            </p>
            <div className="vector-contract-picks-list vector-contract-picks-list-closed">
              {closedPicks.map((pick, i) => renderPickRow(pick, i, { closed: true }))}
            </div>
          </>
        ) : null}
      </div>

      <Drawer
        open={open != null}
        onClose={() => setOpenPick(null)}
        title={open ? `${ticker} ${open.label}` : undefined}
        size="lg"
      >
        {open && play ? (
          <div className="vector-contract-pick-drawer">
            <div className="vector-pick-drawer-hero">
              <div className="vector-pick-drawer-hero-main">
                <span
                  className={clsx(
                    "vector-pick-drawer-side-badge",
                    open.side === "call" ? "vector-pick-drawer-side-badge--call" : "vector-pick-drawer-side-badge--put"
                  )}
                >
                  {open.side === "call" ? "CALL" : "PUT"}
                </span>
                <div className="vector-pick-drawer-hero-text">
                  <p className="vector-contract-pick-drawer-action">{sideActionLabel(open.side)}</p>
                  <p className="vector-contract-pick-drawer-conf">
                    Rank #{open.rank ?? 1}
                    {open.role && ROLE_LABEL[open.role] ? ` · ${ROLE_LABEL[open.role]}` : ""}
                  </p>
                </div>
              </div>
              <div className="vector-pick-conviction-meter" role="img" aria-label={`${play.conviction}% conviction`}>
                <svg viewBox="0 0 36 36" className="vector-pick-conviction-ring">
                  <circle className="vector-pick-conviction-ring-track" cx="18" cy="18" r="15.5" />
                  <circle
                    className="vector-pick-conviction-ring-fill"
                    cx="18"
                    cy="18"
                    r="15.5"
                    strokeDasharray={`${(play.conviction / 100) * 97.4} 97.4`}
                  />
                </svg>
                <span className="vector-pick-conviction-value">{play.conviction}%</span>
                <span className="vector-pick-conviction-label">conviction</span>
              </div>
            </div>

            {open.actionStatus ? (
              <p className={clsx("vector-pick-action-banner", actionClass(open.actionStatus))}>
                <span className="vector-pick-action-banner-dot" aria-hidden="true" />
                {ACTION_LABEL[open.actionStatus]}
                {open.actionReason ? ` — ${open.actionReason}` : ""}
                {open.liveQuotesStale ? (
                  <span
                    className="vector-play-card-stale ml-2"
                    title="Live quote feed hasn't updated recently — this status is the last known-good read"
                  >
                    STALE
                  </span>
                ) : null}
              </p>
            ) : null}

            {(open.liveMid != null || open.liveDelta != null) && (
              <div className="vector-pick-live-greeks">
                {formatPickPremiumRange(open.liveBid ?? null, open.liveAsk ?? null, open.liveMid ?? null) ? (
                  <div className="vector-pick-stat-tile vector-pick-stat-tile--wide">
                    <span className="vector-pick-stat-label">Live premium</span>
                    <span className="vector-pick-stat-value">
                      {formatPickPremiumRange(open.liveBid ?? null, open.liveAsk ?? null, open.liveMid ?? null)}
                    </span>
                    {open.premiumPctFromEntry != null ? (
                      <span
                        className={clsx(
                          "vector-pick-stat-delta",
                          open.premiumPctFromEntry >= 0 ? "vector-pick-stat-delta--up" : "vector-pick-stat-delta--down"
                        )}
                      >
                        {open.premiumPctFromEntry >= 0 ? "+" : ""}
                        {open.premiumPctFromEntry.toFixed(0)}% vs pick
                      </span>
                    ) : null}
                  </div>
                ) : null}
                {open.liveDelta != null ? (
                  <div className="vector-pick-stat-tile">
                    <span className="vector-pick-stat-label">Delta</span>
                    <span className="vector-pick-stat-value">{open.liveDelta.toFixed(2)}</span>
                  </div>
                ) : null}
                {open.liveGamma != null ? (
                  <div className="vector-pick-stat-tile">
                    <span className="vector-pick-stat-label">Gamma</span>
                    <span className="vector-pick-stat-value">{open.liveGamma.toFixed(3)}</span>
                  </div>
                ) : null}
                {open.liveTheta != null ? (
                  <div className="vector-pick-stat-tile">
                    <span className="vector-pick-stat-label">Theta</span>
                    <span className="vector-pick-stat-value">{open.liveTheta.toFixed(3)}</span>
                  </div>
                ) : null}
              </div>
            )}

            <div className="vector-pick-rail-tabs" role="tablist" aria-label="Pick justification">
              <button
                type="button"
                role="tab"
                aria-selected={rail === "desk"}
                className={clsx("vector-pick-rail-tab", rail === "desk" && "vector-pick-rail-tab-active")}
                onClick={() => setRail("desk")}
              >
                Desk data
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={rail === "option"}
                className={clsx("vector-pick-rail-tab", rail === "option" && "vector-pick-rail-tab-active")}
                onClick={() => setRail("option")}
              >
                Option play
              </button>
            </div>

            {rail === "desk" ? (
              <div role="tabpanel" className="vector-pick-rail-panel">
                <p className="vector-pick-desk-rail-lead">
                  Cross-product context grounding this contract — flow, positioning, Thermal, catalysts.
                </p>
                {partitioned ? (
                  <EvidenceRail
                    sections={partitioned.deskData}
                    emptyLabel="No cross-desk data for this pick right now."
                  />
                ) : null}
              </div>
            ) : (
              <div role="tabpanel" className="vector-pick-rail-panel">
                {partitioned ? (
                  <EvidenceRail
                    sections={partitioned.optionPlay}
                    emptyLabel="Contract details loading…"
                  />
                ) : null}

                {open.reasons?.length ? (
                  <div className="vector-pick-rank-reasons">
                    <h3 className="vector-pick-evidence-title">
                      <span className="vector-pick-evidence-code" aria-hidden="true">
                        RNK
                      </span>
                      Why this rank
                    </h3>
                    <ul className="vector-contract-pick-drawer-reasons">
                      {open.reasons.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            )}

            {open.caveat ? (
              <p className="vector-contract-pick-drawer-caveat">{CAVEAT_TEXT[open.caveat]}</p>
            ) : (
              <p className="vector-contract-pick-drawer-ok">
                Passes standard liquidity gates — use a limit at or below the quoted mid.
              </p>
            )}
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
