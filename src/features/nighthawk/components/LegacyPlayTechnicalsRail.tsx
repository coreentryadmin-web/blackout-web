"use client";

import { clsx } from "clsx";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import { targetReachabilityNote } from "@/features/nighthawk/lib/target-reachability";
import {
  legacyMorningHeadline,
  legacyTopFactors,
  legacyWhyPickedSummary,
} from "@/features/nighthawk/lib/legacy-board-detail-copy";
import {
  LegacyDetailBullet,
  LegacyDetailBullets,
  LegacyDetailProse,
  LegacyDetailSection,
} from "@/features/nighthawk/components/legacy-board-detail-primitives";
import type { LegacyBoardTableRow } from "@/features/nighthawk/lib/legacy-board-table-utils";
import { ThesisChecklistPanel } from "@/features/nighthawk/command-deck/TerminalPremiumPanels";

function factorTone(points: number): "up" | "down" | "muted" | undefined {
  if (points > 0) return "up";
  if (points < 0) return "down";
  return "muted";
}

export function LegacyPlayTechnicalsRail({ row }: { row: LegacyBoardTableRow | null }) {
  if (!row) return null;

  const play: TerminalPlay = row.play;
  const factors = legacyTopFactors(play, 12);
  const reachability =
    play.targetAtrMultiple != null ? targetReachabilityNote(play.targetAtrMultiple) : null;
  const morningLine = legacyMorningHeadline(play);
  const tierFactors = play.tierFactors ?? [];

  return (
    <footer className="legacy-board-technicals" aria-label={`${row.ticker} pick reasoning and technicals`}>
      <div className="legacy-board-technicals-head">
        <span className="legacy-board-technicals-ticker">{row.ticker}</span>
        <span className="legacy-board-technicals-sub">
          Pick reasoning · flows · levels · gates
        </span>
        {row.rank != null ? (
          <span className="legacy-board-technicals-badge">Rank #{row.rank}</span>
        ) : null}
        {play.tierLabel ? (
          <span className="legacy-board-technicals-badge">Tier {play.tierLabel}</span>
        ) : null}
        {play.score > 0 ? (
          <span className="legacy-board-technicals-badge">Score {play.score}</span>
        ) : null}
      </div>

      <div className="legacy-board-technicals-grid">
        <LegacyDetailSection title="Why we picked it" className="legacy-board-technicals-col">
          <LegacyDetailProse>{legacyWhyPickedSummary(play)}</LegacyDetailProse>
          <LegacyDetailBullets>
            {play.direction ? (
              <LegacyDetailBullet
                label="Direction"
                value={play.direction}
                sub={play.regime ?? undefined}
              />
            ) : null}
            {play.confluence != null ? (
              <LegacyDetailBullet label="Confluence" value={`${play.confluence} confirming signals`} />
            ) : null}
            {play.keySignal?.trim() ? (
              <LegacyDetailBullet label="Key signal" value={play.keySignal.trim()} />
            ) : null}
            {play.sector ? <LegacyDetailBullet label="Sector" value={play.sector} /> : null}
            {play.whyNow?.label ? (
              <LegacyDetailBullet label="Trigger" value={play.whyNow.label} />
            ) : null}
            {play.scorecard ? (
              <LegacyDetailBullet
                label="Track record"
                value={`${Math.round(play.scorecard.winRate)}% WR · avg ${play.scorecard.avg >= 0 ? "+" : ""}${play.scorecard.avg.toFixed(0)}% · n=${play.scorecard.n}`}
              />
            ) : null}
          </LegacyDetailBullets>
        </LegacyDetailSection>

        <LegacyDetailSection title="Scoring factors" className="legacy-board-technicals-col">
          {factors.length > 0 ? (
            <LegacyDetailBullets>
              {factors.map((f) => (
                <LegacyDetailBullet
                  key={f.label}
                  label={f.label}
                  value={`${f.points > 0 ? "+" : ""}${f.points}`}
                  tone={factorTone(f.points)}
                />
              ))}
            </LegacyDetailBullets>
          ) : play.score > 0 ? (
            <LegacyDetailProse>Composite score {play.score} — factor breakdown not pinned.</LegacyDetailProse>
          ) : (
            <LegacyDetailProse>No scored factors on this edition.</LegacyDetailProse>
          )}
          {tierFactors.length > 0 ? (
            <LegacyDetailBullets className="legacy-detail-bullets--tier">
              {tierFactors.slice(0, 6).map((f, i) => (
                <LegacyDetailBullet
                  key={`${f.label}-${i}`}
                  label={f.label}
                  value={f.direction === "up" ? "▲" : "▼"}
                  sub={f.detail}
                  tone={f.direction === "up" ? "up" : "down"}
                />
              ))}
            </LegacyDetailBullets>
          ) : null}
        </LegacyDetailSection>

        <LegacyDetailSection title="Levels & technicals" className="legacy-board-technicals-col">
          <LegacyDetailBullets>
            {play.stopLevel ? <LegacyDetailBullet label="Support / stop" value={play.stopLevel} tone="down" /> : null}
            {play.entryRange ? <LegacyDetailBullet label="Entry band" value={play.entryRange} /> : null}
            {play.targetLevel ? (
              <LegacyDetailBullet label="Resistance / target" value={play.targetLevel} tone="up" />
            ) : null}
            {play.ivRank != null ? (
              <LegacyDetailBullet label="IV rank" value={`${Math.round(play.ivRank)}`} />
            ) : null}
            {play.targetAtrMultiple != null ? (
              <LegacyDetailBullet label="Target reach" value={`${play.targetAtrMultiple.toFixed(1)}× ATR`} />
            ) : null}
            {reachability ? <LegacyDetailBullet label="Reachability" value={reachability} tone="warn" /> : null}
            {play.stockPeakPct != null ? (
              <LegacyDetailBullet
                label="Stock peak"
                value={`${play.stockPeakPct >= 0 ? "+" : ""}${play.stockPeakPct.toFixed(1)}%`}
                tone={play.stockPeakPct >= 0 ? "up" : "down"}
              />
            ) : null}
            {play.stockTroughPct != null ? (
              <LegacyDetailBullet
                label="Stock trough"
                value={`${play.stockTroughPct >= 0 ? "+" : ""}${play.stockTroughPct.toFixed(1)}%`}
                tone={play.stockTroughPct < 0 ? "down" : "muted"}
              />
            ) : null}
          </LegacyDetailBullets>
        </LegacyDetailSection>

        <LegacyDetailSection title="Gates & checks" className="legacy-board-technicals-col">
          <LegacyDetailBullets>
            {morningLine ? (
              <LegacyDetailBullet
                label="Pre-market"
                value={morningLine}
                tone={
                  play.morningStatus === "CONFIRMED"
                    ? "up"
                    : play.morningStatus === "DEGRADED"
                      ? "warn"
                      : play.morningStatus === "INVALIDATED"
                        ? "down"
                        : "muted"
                }
              />
            ) : null}
            {play.gates.length > 0 ? (
              play.gates.map((g) => (
                <LegacyDetailBullet
                  key={g.label}
                  label={g.label}
                  value={g.ok ? "Pass" : "Fail"}
                  tone={g.ok ? "up" : "down"}
                />
              ))
            ) : (
              <LegacyDetailBullet label="Publish gates" value="Cleared standard funnel" tone="up" />
            )}
            {play.thesisBreak?.level === "warn" && play.thesisBreak.note ? (
              <LegacyDetailBullet label="Caveat" value={play.thesisBreak.note} tone="warn" />
            ) : null}
            {play.premiumCapOk === false ? (
              <LegacyDetailBullet label="Premium cap" value="Above desk cap at publish" tone="down" />
            ) : null}
          </LegacyDetailBullets>
          <div className="legacy-board-technicals-checklist">
            <ThesisChecklistPanel play={play} />
          </div>
        </LegacyDetailSection>
      </div>
    </footer>
  );
}
