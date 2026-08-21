"use client";

/**
 * REPORT — the 10-second decision surface. It answers ONE question: should I care about this
 * earnings event, and why?
 *
 * Density ladder, top to bottom:
 *   L1 decision   — halo (verdict + agreement), countdown, expected-move rail
 *   L2 signals    — five dimension reads, each clickable into its pillars
 *   L3 analytics  — structure ladder, beat history, revisions, dark pool
 *   L4 evidence   — news/insider, COLLAPSED by default
 *   L5 raw        — inside the drawer
 *
 * The previous version inverted this: raw headlines and analyst lines occupied the primary
 * surface while the verdict was a word in a box. Nothing here renders a value the payload does
 * not carry — every primitive returns null instead of drawing a zero (see meridian-viz-core).
 */

import { useMemo, useState } from "react";
import type {
  MeridianCatalystHeadline,
  MeridianEarningsEnrichment,
  MeridianEarningsIntel,
  MeridianEarningsReportSignal,
} from "@/features/meridian/lib/meridian-types";
import {
  dimensionRollup,
  PILLAR_DIMENSION,
  type MeridianDimension,
} from "@/lib/meridian/meridian-viz-core";
import {
  earningsTabForDimension,
  earningsTabNavLabel,
  type MeridianEarningsTabId,
} from "@/lib/meridian/meridian-earnings-tab-nav-core";
import { MeridianHalo3D, MeridianOrbital } from "./meridian-spatial";
import {
  MeridianBeatHistory,
  MeridianCountdown,
  MeridianDarkPoolTape,
  MeridianMoveRail,
  MeridianRevisionMomentum,
  MeridianRing,
  MeridianStructureLadder,
  MeridianTargetRail,
  type RailMarker,
} from "./meridian-viz";

type Lean = "bullish" | "bearish" | "neutral";
const leanClass = (l: string): string =>
  l === "bullish" ? "mv-bull" : l === "bearish" ? "mv-bear" : "mv-neutral";

type Props = {
  ticker: string;
  intel: MeridianEarningsIntel;
  enrichment: Pick<
    MeridianEarningsEnrichment,
    | "earnings_headlines"
    | "catalysts"
    | "analyst_revisions"
    | "insider_activity"
    | "print_history"
    | "price_targets"
    | "street_skew"
  >;
  /** ISO instant of the print, for the countdown. */
  eventAt?: string | null;
  /** Jump from a dimension drill-down to the tab that holds the full book. */
  onNavigateTab?: (tab: MeridianEarningsTabId) => void;
};

export function MeridianEarningsReportPanel({ ticker, intel, enrichment, eventAt, onNavigateTab }: Props) {
  const { report, thermal, dark_pool: darkPool } = intel;
  // Drawer state: which dimension (if any) is expanded into its underlying pillars.
  const [openDim, setOpenDim] = useState<MeridianDimension | null>(null);
  const [showEvidence, setShowEvidence] = useState(false);
  const [showOrbital, setShowOrbital] = useState(false);
  // Hovering a dealer level highlights the same price on the expected-move rail above it —
  // the cross-filter that makes two panels read as one book rather than two lists.
  const [hoverLevel, setHoverLevel] = useState<number | null>(null);

  const dims = useMemo(() => dimensionRollup(report?.signals), [report?.signals]);

  const drawerSignals = useMemo(
    () =>
      openDim
        ? (report?.signals ?? []).filter((s) => PILLAR_DIMENSION[s.pillar] === openDim)
        : [],
    [openDim, report?.signals]
  );

  // Every marker drawn on the rail is also folded into its DOMAIN — passing only the band would
  // clamp an out-of-band wall to the rail's end, which reads as "the wall is at the boundary".
  const railMarkers = useMemo<RailMarker[]>(
    () =>
      [
        { value: thermal?.call_wall ?? null, label: "call wall", kind: "wall" as const },
        { value: thermal?.put_wall ?? null, label: "put wall", kind: "wall" as const },
        { value: thermal?.max_pain ?? null, label: "max pain", kind: "level" as const },
        { value: thermal?.gex_king_strike ?? null, label: "king", kind: "level" as const },
      ].filter((m) => m.value != null),
    [thermal]
  );

  if (!report?.available) return null;

  return (
    <section className="mr" aria-label={`${ticker} earnings report`}>
      {/* ── L1 · DECISION ─────────────────────────────────────────────────────────── */}
      <div className="mr-decision">
        <MeridianHalo3D
          signals={report.signals}
          score={report.score}
          verdict={report.verdict as Lean}
          confidence={report.confidence}
          // Clicking a ring drills into what that ring measures. "Evidence" opens the heaviest
          // dimension because that is the one the ring is mostly made of; the other two layers
          // are model-level reads with no single dimension behind them, so they open the
          // orbital view instead of pretending to have a drilldown.
          onLayerClick={(layer) => {
            if (layer === "pillars") {
              const heaviest = [...(report.signals ?? [])].sort(
                (a, b) => Math.abs(b.weight ?? 0) - Math.abs(a.weight ?? 0)
              )[0];
              setOpenDim(heaviest ? PILLAR_DIMENSION[heaviest.pillar] ?? null : null);
            } else {
              setShowOrbital(true);
            }
          }}
        />

        <div className="mr-decision-body">
          <div className="mr-decision-top">
            <h3 className={`mr-headline ${leanClass(report.verdict)}`}>{report.headline}</h3>
            {eventAt && <MeridianCountdown targetIso={eventAt} />}
          </div>
          <p className="mr-summary">{report.summary}</p>

          <div className="mr-dims" role="group" aria-label="Signal dimensions">
            {dims.map((d) => (
              <button
                type="button"
                key={d.dimension}
                className={`mr-dim${openDim === d.dimension ? " is-open" : ""}`}
                onClick={() => setOpenDim(openDim === d.dimension ? null : d.dimension)}
                aria-expanded={openDim === d.dimension}
              >
                <MeridianRing
                  label={d.dimension}
                  value={d.intensity}
                  lean={d.lean as Lean}
                  size={48}
                />
                <span className="mr-dim-meta">
                  {d.contributing} signal{d.contributing === 1 ? "" : "s"}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Drawer — L2 drilldown. In-context, not a separate page. */}
      {openDim && (
        <div className="mr-drawer" role="region" aria-label={`${openDim} signals`}>
          <div className="mr-drawer-head">
            <span className="mr-drawer-title">{openDim} · contributing signals</span>
            <button type="button" className="mr-drawer-close" onClick={() => setOpenDim(null)}>
              close
            </button>
          </div>
          <ul className="mr-drawer-list">
            {drawerSignals.map((s: MeridianEarningsReportSignal) => (
              <li key={s.pillar} className="mr-drawer-row">
                <span className={`mr-drawer-lean ${leanClass(s.lean)}`} aria-hidden="true" />
                <span className="mr-drawer-label">{s.label}</span>
                <span className="mr-drawer-detail">{s.detail}</span>
                <span className={`mr-drawer-score ${leanClass(s.lean)}`}>
                  {s.score > 0 ? "+" : ""}
                  {s.score}
                </span>
              </li>
            ))}
          </ul>
          {onNavigateTab && (
            <div className="mr-drawer-foot">
              <button
                type="button"
                className="mr-drawer-jump"
                onClick={() => onNavigateTab(earningsTabForDimension(openDim))}
              >
                Open full {earningsTabNavLabel(earningsTabForDimension(openDim))} →
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── L2/L3 · ANALYTICS GRID ─────────────────────────────────────────────────── */}
      <div className="mr-grid">
        <div className="mr-panel mr-panel-wide">
          <MeridianMoveRail
            band={intel.expected_move_band}
            movePct={intel.expected_move_pct}
            markers={
              hoverLevel === null
                ? railMarkers
                : [...railMarkers, { value: hoverLevel, label: "◆", kind: "level" }]
            }
            source={intel.expected_move_source ?? undefined}
          />
        </div>

        {thermal?.available && (
          <div className="mr-panel">
            <span className="mr-panel-title">Dealer structure</span>
            <MeridianStructureLadder thermal={thermal} onLevelHover={setHoverLevel} />
            {thermal.net_gex_label && (
              <p className="mv-note">
                net GEX {thermal.net_gex_label}
                {thermal.gamma_regime ? ` · ${thermal.gamma_regime}` : ""}
              </p>
            )}
          </div>
        )}

        <div className="mr-panel mr-panel-orbital">
          <div className="mr-panel-head">
            <span className="mr-panel-title">Signal orbit</span>
            <button
              type="button"
              className="mr-panel-toggle"
              onClick={() => setShowOrbital((v) => !v)}
              aria-expanded={showOrbital}
            >
              {showOrbital ? "collapse" : "expand"}
            </button>
          </div>
          <MeridianOrbital
            signals={report.signals}
            verdict={report.verdict as Lean}
            size={showOrbital ? 400 : 310}
            onPillarClick={(pillar) => setOpenDim(PILLAR_DIMENSION[pillar] ?? null)}
          />
        </div>

        <div className="mr-panel">
          <MeridianBeatHistory prints={enrichment.print_history} />
        </div>

        <div className="mr-panel">
          <MeridianRevisionMomentum
            skew={enrichment.street_skew}
            onExpand={() => setShowEvidence(true)}
          />
          <MeridianTargetRail targets={enrichment.price_targets} spot={thermal?.spot ?? null} />
        </div>

        {darkPool?.available && (
          <div className="mr-panel">
            <MeridianDarkPoolTape
              prints={darkPool.top_prints}
              totalLabel={darkPool.total_premium_label}
            />
          </div>
        )}

        <div className="mr-panel mr-panel-play">
          <span className="mr-panel-title">Best play read</span>
          <p className={`mr-play-headline ${leanClass(report.verdict)}`}>
            {report.best_play.headline}
          </p>
          <p className="mr-play-structure">{report.best_play.structure}</p>
          <p className="mr-play-risk">{report.best_play.risk}</p>
        </div>
      </div>

      {/* ── L4 · EVIDENCE — collapsed. Raw headlines are support, not the dashboard. ── */}
      <EvidenceSection
        open={showEvidence}
        onToggle={() => setShowEvidence((v) => !v)}
        headlines={[...enrichment.earnings_headlines, ...enrichment.catalysts].slice(0, 10)}
        revisions={enrichment.analyst_revisions.slice(0, 8)}
        insiders={enrichment.insider_activity.slice(0, 5)}
      />

      <p className="mr-disclaimer">{report.risk_note}</p>
    </section>
  );
}

function EvidenceSection({
  open,
  onToggle,
  headlines,
  revisions,
  insiders,
}: {
  open: boolean;
  onToggle: () => void;
  headlines: MeridianCatalystHeadline[];
  revisions: MeridianEarningsEnrichment["analyst_revisions"];
  insiders: MeridianEarningsEnrichment["insider_activity"];
}) {
  const count = headlines.length + revisions.length + insiders.length;
  if (count === 0) return null;
  return (
    <div className="mr-evidence">
      <button type="button" className="mr-evidence-toggle" onClick={onToggle} aria-expanded={open}>
        <span className="mr-evidence-caret" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
        Supporting evidence
        <span className="mr-evidence-count">{count}</span>
      </button>
      {open && (
        <div className="mr-evidence-body">
          {headlines.length > 0 && (
            <div className="mr-evidence-col">
              <span className="mr-evidence-label">News &amp; catalysts</span>
              <ul>
                {headlines.map((h) => (
                  <li key={`${h.title}-${h.published ?? ""}`}>
                    {h.title}
                    {h.channel ? <span className="mr-evidence-chan"> · {h.channel}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {revisions.length > 0 && (
            <div className="mr-evidence-col">
              <span className="mr-evidence-label">Analyst revisions</span>
              <ul>
                {revisions.map((r) => (
                  <li key={r.title}>
                    {r.title}
                    {r.action ? <span className="mr-evidence-chan"> · {r.action}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {insiders.length > 0 && (
            <div className="mr-evidence-col">
              <span className="mr-evidence-label">Insider filings</span>
              <ul>
                {insiders.map((r) => (
                  <li key={r.title}>{r.title}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
