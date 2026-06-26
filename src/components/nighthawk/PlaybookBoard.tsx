"use client";

import { Badge } from "@/components/ui";
import { PlaybookPlayRow } from "./PlaybookPlayRow";
import type { NightHawkEdition, PlaybookPlay } from "@/lib/nighthawk/types";

type PlaybookBoardProps = {
  edition: NightHawkEdition | undefined;
  loading?: boolean;
  onPlaySelect?: (play: PlaybookPlay) => void;
};

const SLOT_COUNT = 5;

/** A published edition has something to show (a recap) even with zero plays. Mirror the server-side
 *  gate (rowToNightHawkEdition / hasRecapContent) on the client so the recap state renders whenever
 *  ANY recap content is present — independent of the `recap_only` flag, which a stale/older row may
 *  not carry. This is the invariant for #77: never show "Playbook pending" once a recap exists. */
function editionHasRecapContent(edition: NightHawkEdition | undefined): boolean {
  if (!edition) return false;
  if (edition.recap_headline && edition.recap_headline.trim()) return true;
  if (edition.recap_summary && edition.recap_summary.trim()) return true;
  if (edition.market_recap && Object.keys(edition.market_recap).length > 0) return true;
  return false;
}

export function PlaybookBoard({ edition, loading, onPlaySelect }: PlaybookBoardProps) {
  const plays = edition?.plays ?? [];
  const hasPlays = plays.length > 0;
  const hasRecap = editionHasRecapContent(edition);
  // Render the recap (not "pending") whenever the edition is available OR carries recap content.
  // INVARIANT (#77): when the API marks the edition available=true the page must NEVER show
  // "Playbook pending" — and we additionally self-heal any row where `available` lagged but a real
  // recap is present. recap_only is intentionally NOT consulted here.
  const showRecapState = (Boolean(edition?.available) || hasRecap) && !hasPlays;
  const editionLabel = edition?.edition_for
    ? new Date(`${edition.edition_for}T12:00:00`).toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      })
    : null;

  return (
    <section className="nighthawk-playbook">
      <header className="nighthawk-playbook-header">
        <div className="nighthawk-playbook-header-main">
          <p className="nighthawk-playbook-kicker">Tonight&apos;s playbook</p>
          <h2 className="nighthawk-playbook-title">
            {editionLabel ? `For ${editionLabel}` : "Next session"}
          </h2>
          {edition?.recap_headline && (
            <p className="nighthawk-playbook-headline">{edition.recap_headline}</p>
          )}
        </div>

        <div className="nighthawk-playbook-header-meta">
          {edition?.market_recap && (
            <div className="nighthawk-playbook-recap-grid">
              {typeof edition.market_recap.tide === "string" && (
                <span>Tide · {edition.market_recap.tide}</span>
              )}
              {typeof edition.market_recap.spx_vix === "string" && (
                <span>SPX/VIX · {edition.market_recap.spx_vix}</span>
              )}
              {typeof edition.market_recap.sector_strength === "string" && (
                <span>↑ {edition.market_recap.sector_strength}</span>
              )}
              {typeof edition.market_recap.sector_weakness === "string" && (
                <span>↓ {edition.market_recap.sector_weakness}</span>
              )}
            </div>
          )}
          {loading ? (
            <Badge tone="sky">Syncing…</Badge>
          ) : hasPlays ? (
            <Badge tone="bull" dot>
              Edition live
            </Badge>
          ) : showRecapState ? (
            <Badge tone="sky" dot>
              Recap live
            </Badge>
          ) : (
            <Badge tone="bear">Awaiting close</Badge>
          )}
        </div>
      </header>

      {edition?.recap_summary && (
        <p className="nighthawk-playbook-recap">{edition.recap_summary}</p>
      )}

      {hasPlays && (
        <p className="nighthawk-playbook-hint">Click any play for full Hawk Intel briefing</p>
      )}

      {hasPlays ? (
        <div className="nighthawk-playbook-rows">
          {Array.from({ length: SLOT_COUNT }, (_, i) => {
            const play = plays[i];
            return (
              <PlaybookPlayRow
                key={play ? `${play.ticker}-${play.rank}` : `slot-${i + 1}`}
                rank={i + 1}
                play={play}
                empty={!play}
                onSelect={play && onPlaySelect ? () => onPlaySelect(play) : undefined}
              />
            );
          })}
        </div>
      ) : showRecapState ? (
        // Recap-only edition: a real market read published, but no ranked plays survived the funnel
        // tonight. Show a recap-only note instead of the "awaiting close" pending state — the recap
        // itself renders above via recap_headline / market_recap / recap_summary. Gated on
        // available||recap-content (NOT recap_only) so a stale row missing the flag still renders here.
        <div className="nighthawk-playbook-pending" role="status">
          <div className="nighthawk-playbook-pending-inner">
            <p className="nighthawk-playbook-pending-kicker">◆ Overnight recon</p>
            <h3 className="nighthawk-playbook-pending-title">Market recap published</h3>
            <p className="nighthawk-playbook-pending-sub">
              No ranked plays cleared tonight&apos;s screen — the market read above is your
              overnight brief. Ranked setups return when the flow lines up.
            </p>
          </div>
        </div>
      ) : (
        <div className="nighthawk-playbook-pending" role="status">
          <div className="nighthawk-playbook-pending-inner">
            <p className="nighthawk-playbook-pending-kicker">◆ Overnight recon</p>
            <h3 className="nighthawk-playbook-pending-title">Playbook pending</h3>
            <p className="nighthawk-playbook-pending-sub">
              Five ranked swing + leap setups publish after the cash close —{" "}
              <span className="nighthawk-playbook-pending-time">~5:30 PM ET</span>.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
