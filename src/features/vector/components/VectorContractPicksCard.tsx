"use client";

import { useState } from "react";
import clsx from "clsx";
import { Drawer } from "@/components/ui";
import type { VectorContractPick } from "@/lib/api";
import type { VectorPlay } from "@/features/vector/lib/vector-play-engine";

type Props = {
  ticker: string;
  play: VectorPlay | null;
  picks: VectorContractPick[];
  loading: boolean;
  className?: string;
};

const CAVEAT_TEXT: Record<NonNullable<VectorContractPick["caveat"]>, string> = {
  premium_high: "Premium above the standard cap — verify size.",
  low_liquidity: "Thin open interest — use a limit order.",
  premium_high_low_liquidity: "Premium above cap and thin open interest — verify size and use a limit order.",
};

const ROLE_LABEL: Record<string, string> = {
  "primary-long": "Primary long",
  "primary-short": "Primary short",
  "fade-dip": "Range fade — buy dip",
  "fade-rip": "Range fade — sell rip",
  "flow-whale": "HELIX whale anchor",
};

/**
 * Ranked 1–3 contract ideas with per-pick confidence and evidence bullets in the drawer.
 */
export function VectorContractPicksCard({ ticker, play, picks, loading, className }: Props) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  if (!picks.length) return null;
  const open = openIdx != null ? picks[openIdx] : null;

  return (
    <div className={clsx("vp-intel vector-contract-picks-card", className)}>
      <div className="vp-intel-card">
        <div className="vp-intel-card-head">
          <span className="vp-intel-card-icon">🎯</span>
          <span className="vp-intel-card-title">
            {ticker} PLAYS{loading ? " · updating" : ""}
          </span>
        </div>
        <div className="vector-contract-picks-list">
          {picks.map((pick, i) => (
            <button
              key={`${pick.side}-${pick.strike}-${pick.expiry}`}
              type="button"
              className="vector-contract-pick-row"
              onClick={() => setOpenIdx(i)}
            >
              <span className="vector-contract-pick-rank">{pick.rank ?? i + 1}.</span>
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
              <span className="vector-contract-pick-confidence">{pick.confidence}%</span>
            </button>
          ))}
        </div>
      </div>

      <Drawer
        open={open != null}
        onClose={() => setOpenIdx(null)}
        title={open ? `${ticker} ${open.label}` : undefined}
        size="sm"
      >
        {open && play ? (
          <div className="vector-contract-pick-drawer">
            <p className="vector-contract-pick-drawer-conf">
              {open.confidence}% conviction
              {open.role && ROLE_LABEL[open.role] ? ` · ${ROLE_LABEL[open.role]}` : ""}
            </p>
            {open.reasons?.length ? (
              <ul className="vector-contract-pick-drawer-reasons">
                {open.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            ) : null}
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
              <div className="vector-contract-pick-drawer-level">
                <dt>Contract</dt>
                <dd>
                  {open.label} @ ${open.premium.toFixed(2)}
                </dd>
              </div>
            </dl>
            {open.caveat ? (
              <p className="vector-contract-pick-drawer-caveat">{CAVEAT_TEXT[open.caveat]}</p>
            ) : null}
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
