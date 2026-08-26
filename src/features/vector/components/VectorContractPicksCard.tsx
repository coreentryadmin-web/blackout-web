"use client";

import { useState } from "react";
import clsx from "clsx";
import { Drawer } from "@/components/ui";
import type { VectorContractPick, VectorPickEvidenceSection } from "@/lib/api";
import type { VectorPlay } from "@/features/vector/lib/vector-play-engine";
import { partitionPickEvidence } from "@/features/vector/lib/vector-pick-evidence-rails";
import { formatPickPremiumRange } from "@/features/vector/lib/vector-pick-live-status";

type Props = {
  ticker: string;
  play: VectorPlay | null;
  picks: VectorContractPick[];
  loading: boolean;
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

function EvidenceBlock({ section }: { section: VectorPickEvidenceSection }) {
  return (
    <section className="vector-pick-evidence-section">
      <h3 className="vector-pick-evidence-title">{section.title}</h3>
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
export function VectorContractPicksCard({ ticker, play, picks, loading, className }: Props) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [rail, setRail] = useState<DrawerRail>("option");

  if (!picks.length) return null;
  const open = openIdx != null ? picks[openIdx] : null;
  const partitioned = open?.evidence?.length ? partitionPickEvidence(open.evidence) : null;

  return (
    <div className={clsx("vp-intel vector-contract-picks-card", className)}>
      <div className="vp-intel-card">
        <div className="vp-intel-card-head">
          <span className="vp-intel-card-icon">🎯</span>
          <span className="vp-intel-card-title">
            {ticker} PLAYS
            {play ? ` · ${play.conviction}% play` : ""}
            {loading ? " · updating" : ""}
          </span>
        </div>
        <p className="vector-contract-picks-sub">Buy-to-open contracts · ranked by setup quality</p>
        <div className="vector-contract-picks-list">
          {picks.map((pick, i) => {
            const liveRange =
              formatPickPremiumRange(pick.liveBid ?? null, pick.liveAsk ?? null, pick.liveMid ?? null) ??
              formatPickPremiumRange(pick.entryBid ?? null, pick.entryAsk ?? null, pick.entryMid ?? pick.premium);
            return (
            <button
              key={`${pick.side}-${pick.strike}-${pick.expiry}`}
              type="button"
              className="vector-contract-pick-row"
              onClick={() => {
                setOpenIdx(i);
                setRail("option");
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
                {liveRange ? (
                  <span className="vector-contract-pick-premium">{liveRange}</span>
                ) : null}
              </span>
              {pick.actionStatus ? (
                <span className={clsx("vector-pick-action-chip", actionClass(pick.actionStatus))}>
                  {ACTION_LABEL[pick.actionStatus]}
                </span>
              ) : null}
              {(pick.rank ?? i + 1) === 1 && !pick.actionStatus ? (
                <span className="vector-contract-pick-primary-tag">Primary</span>
              ) : null}
            </button>
            );
          })}
        </div>
      </div>

      <Drawer
        open={open != null}
        onClose={() => setOpenIdx(null)}
        title={open ? `${ticker} ${open.label}` : undefined}
        size="md"
      >
        {open && play ? (
          <div className="vector-contract-pick-drawer">
            <p className="vector-contract-pick-drawer-conf">
              Rank #{open.rank ?? 1}
              {open.role && ROLE_LABEL[open.role] ? ` · ${ROLE_LABEL[open.role]}` : ""}
              {" · "}
              {play.conviction}% Suggested Play conviction
            </p>
            <p className="vector-contract-pick-drawer-action">{sideActionLabel(open.side)}</p>
            {open.actionStatus ? (
              <p className={clsx("vector-pick-action-banner", actionClass(open.actionStatus))}>
                {ACTION_LABEL[open.actionStatus]}
                {open.actionReason ? ` — ${open.actionReason}` : ""}
              </p>
            ) : null}
            {(open.liveMid != null || open.liveDelta != null) && (
              <dl className="vector-pick-live-greeks">
                {formatPickPremiumRange(open.liveBid ?? null, open.liveAsk ?? null, open.liveMid ?? null) ? (
                  <div className="vector-contract-pick-drawer-level">
                    <dt>Live premium</dt>
                    <dd>
                      {formatPickPremiumRange(open.liveBid ?? null, open.liveAsk ?? null, open.liveMid ?? null)}
                      {open.premiumPctFromEntry != null
                        ? ` (${open.premiumPctFromEntry >= 0 ? "+" : ""}${open.premiumPctFromEntry.toFixed(0)}% vs pick)`
                        : ""}
                    </dd>
                  </div>
                ) : null}
                {open.liveDelta != null ? (
                  <div className="vector-contract-pick-drawer-level">
                    <dt>Delta</dt>
                    <dd>{open.liveDelta.toFixed(2)}</dd>
                  </div>
                ) : null}
                {open.liveGamma != null ? (
                  <div className="vector-contract-pick-drawer-level">
                    <dt>Gamma</dt>
                    <dd>{open.liveGamma.toFixed(3)}</dd>
                  </div>
                ) : null}
                {open.liveTheta != null ? (
                  <div className="vector-contract-pick-drawer-level">
                    <dt>Theta</dt>
                    <dd>{open.liveTheta.toFixed(3)}</dd>
                  </div>
                ) : null}
              </dl>
            )}

            <div className="vector-pick-rail-tabs" role="tablist" aria-label="Pick justification">
              <button
                type="button"
                role="tab"
                aria-selected={rail === "option"}
                className={clsx("vector-pick-rail-tab", rail === "option" && "vector-pick-rail-tab-active")}
                onClick={() => setRail("option")}
              >
                Option play
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={rail === "desk"}
                className={clsx("vector-pick-rail-tab", rail === "desk" && "vector-pick-rail-tab-active")}
                onClick={() => setRail("desk")}
              >
                Desk data
              </button>
            </div>

            {rail === "option" ? (
              <div role="tabpanel" className="vector-pick-rail-panel">
                {partitioned ? (
                  <EvidenceRail
                    sections={partitioned.optionPlay}
                    emptyLabel="Contract details loading…"
                  />
                ) : null}

                {open.reasons?.length ? (
                  <div className="vector-pick-rank-reasons">
                    <h3 className="vector-pick-evidence-title">Why this rank</h3>
                    <ul className="vector-contract-pick-drawer-reasons">
                      {open.reasons.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div className="vector-pick-play-plan">
                  <h3 className="vector-pick-evidence-title">Play plan</h3>
                  <p className="vector-contract-pick-drawer-headline">{play.headline}</p>
                  <p className="vector-contract-pick-drawer-thesis">{play.thesis}</p>
                  <dl className="vector-contract-pick-drawer-levels">
                    {play.entryZone ? (
                      <div className="vector-contract-pick-drawer-level">
                        <dt>Entry</dt>
                        <dd>{play.entryZone}</dd>
                      </div>
                    ) : null}
                    {play.targets.length ? (
                      <div className="vector-contract-pick-drawer-level">
                        <dt>Targets</dt>
                        <dd>{play.targets.join(" → ")}</dd>
                      </div>
                    ) : null}
                    {play.invalidation ? (
                      <div className="vector-contract-pick-drawer-level">
                        <dt>Invalidation</dt>
                        <dd>{play.invalidation}</dd>
                      </div>
                    ) : null}
                  </dl>
                </div>
              </div>
            ) : (
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
