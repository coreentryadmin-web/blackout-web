"use client";

import { clsx } from "clsx";
import type { TerminalPlay } from "./types";
import { DeskEvidenceStack } from "@/features/nighthawk/components/DeskEvidenceStack";
import { ARCHETYPE_LABEL } from "@/lib/zerodte/thesis/archetype";
import { managementFor } from "./adapters";
import { showsTimeStopClock, showsTrimScaleLadder, showsRatchetTrack } from "./terminal-guards";
import { etClock } from "./PlayTerminal";
import { PlayTimelinePanel } from "./PlayTimelinePanel";
import { useFlash } from "./use-deck-live";
import { isZeroDtePremiumTerminal } from "./terminal-display";
import {
  ManagementActionCard,
  ThesisExpectedMove,
  TradeExcursionGraphic,
  VisualTrimLadder,
} from "./TerminalPremiumPanels";
import { CondorPanel, TimeStopClock } from "./play-terminal-shared";

const usd = (n: number | null | undefined): string => (n != null ? `$${n.toFixed(2)}` : "—");
const signPct = (n: number | null | undefined): string =>
  n != null ? `${n > 0 ? "+" : ""}${Math.round(n)}%` : "—";

function fmtStrike(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function verdictThesisLine(play: TerminalPlay, sessionClosed: boolean): string | null {
  const level = play.thesisBreak?.level ?? "intact";
  const broke = level === "warn" || level === "break";
  if (play.thesisHealth?.advisory) return play.thesisHealth.advisory;
  if (broke && play.thesisBreak?.note) return play.thesisBreak.note;
  if (play.thesisHealth?.health != null) {
    return `Thesis health ${play.thesisHealth.health} — ${sessionClosed || play.status === "CLOSED" ? "frozen at close" : "live from board poll"}`;
  }
  if (level === "unknown") return play.thesisBreak?.note ?? "Thesis monitor unavailable for this play";
  if (sessionClosed || play.status === "CLOSED") return "Frozen at close — last board read";
  return "Tape alignment from the board poll; mark/P&L from the marks stream";
}

function Bar({ pts }: { pts: number }) {
  const w = Math.max(2, Math.min(100, (Math.abs(pts) / 30) * 100));
  return (
    <div className="bar">
      <i style={{ width: `${w}%` }} />
    </div>
  );
}

/** 0DTE Command v2 — verdict strip, evidence stack, live band, collapsible technicals + log. */
export function ZeroDteCommandPanel({
  play,
  nowMs,
  sessionClosed = false,
}: {
  play: TerminalPlay;
  nowMs: number;
  sessionClosed?: boolean;
}) {
  const markFlash = useFlash(play.mark ?? play.pnlPct ?? null);
  const premium = isZeroDtePremiumTerminal(play);
  const isCandidate = play.status === "WATCH" || play.status === "SKIP";
  const isCondor = play.isCondor === true;
  const isWorking = play.status === "OPEN" || play.status === "HOLD" || play.status === "TRIM";
  const mgmt = managementFor(play.exitModel, play.status, play.pnlPct ?? null);
  const badge =
    play.horizon === "ZERO_DTE" && play.recommendation
      ? play.recommendation
      : mgmt.recommendation;
  const recNote =
    play.horizon === "ZERO_DTE" && play.recNote ? play.recNote : mgmt.recNote;
  const thesisLine = verdictThesisLine(play, sessionClosed);
  const whyAt = etClock(play.firstFlaggedAt);
  const topFactors = play.factors.slice(0, 2);
  const moreFactors = play.factors.slice(2);
  const mark = play.mark;
  const stopP = play.exitPolicy?.stop_premium ?? null;
  const tgtP = play.exitPolicy?.target_premium ?? null;
  const distLine = (() => {
    if (mark == null || (stopP == null && tgtP == null)) return null;
    const parts: string[] = [];
    if (stopP != null) {
      const d = stopP - mark;
      parts.push(`stop ${d >= 0 ? "+" : ""}${d.toFixed(2)} (${usd(stopP)})`);
    }
    if (tgtP != null) {
      const d = tgtP - mark;
      parts.push(`target ${d >= 0 ? "+" : ""}${d.toFixed(2)} (${usd(tgtP)})`);
    }
    return parts.join(" · ");
  })();
  const hasEntry = play.entry != null;
  const pnlPct = play.pnlPct;
  const technicalsOpen = !isWorking;

  return (
    <div className="nh-deck-command-panel nh-deck-command-panel-v2 nh-deck-body">
      <div className="nh-deck-verdict-band" aria-label="Verdict">
        <span className={clsx("nh-deck-verdict-band__rec", `is-${badge.toLowerCase()}`)}>{badge}</span>
        {hasEntry && pnlPct != null && (
          <span
            className={clsx(
              "nh-deck-verdict-band__pnl",
              pnlPct > 0 && "nh-deck-pos",
              pnlPct < 0 && "nh-deck-neg",
            )}
          >
            {pnlPct >= 0 ? "+" : ""}
            {pnlPct.toFixed(1)}%
          </span>
        )}
        {thesisLine && <span className="nh-deck-verdict-band__thesis">{thesisLine}</span>}
      </div>

      <section className="nh-deck-command-section" aria-labelledby="nh-cmd-evidence">
        <h3 id="nh-cmd-evidence" className="nh-deck-command-heading">
          Why we picked it
        </h3>
        {play.thesisFirst ? (
          <>
            <DeskEvidenceStack thesis={play.thesisFirst} />
            {play.thesisFirst.expression?.contract && (
              <p className="nh-deck-command-contract">
                {fmtStrike(play.thesisFirst.expression.contract.strike)}
                {play.thesisFirst.expression.contract.side === "call" ? "C" : "P"} ·{" "}
                {play.thesisFirst.expression.dte_target}DTE
                {play.thesisFirst.expression.rationale ? ` — ${play.thesisFirst.expression.rationale}` : ""}
              </p>
            )}
            <p className="nh-deck-command-archetype">
              {ARCHETYPE_LABEL[play.thesisFirst.thesis.trade_archetype]} · tier{" "}
              {play.thesisFirst.rank_tier}
              {play.confluence != null ? ` · confluence ${play.confluence}/2` : ""}
            </p>
          </>
        ) : (
          <p className="nh-deck-recnote">
            Cross-desk evidence not stored for this row — score {play.score}
            {play.thesis ? `: ${play.thesis}` : ""}
          </p>
        )}
        {play.whyNow && (
          <div className="nh-deck-whynow" title="Scan trigger at discovery">
            <span className="ic" aria-hidden>
              ⚡
            </span>
            <span className="lb">triggered by:</span>
            <span className="rs">{play.whyNow.label}</span>
            {whyAt && <span className="at"> · {whyAt} ET</span>}
          </div>
        )}
      </section>

      <section className="nh-deck-command-section nh-deck-command-live" aria-labelledby="nh-cmd-live">
        <h3 id="nh-cmd-live" className="nh-deck-command-heading">
          Live · management
        </h3>
        {isCandidate && <div className="nh-deck-recnote nh-deck-premium-note">{recNote}</div>}
        {premium && !isCondor && !isCandidate && (
          <div className="nh-deck-premium-stack">
            <ManagementActionCard play={play} recommendation={badge} progress={mgmt.progress} />
            <VisualTrimLadder play={play} />
          </div>
        )}
        {!premium && !isCandidate && (
          <div className="nh-deck-rec">
            <span className={clsx("nh-deck-recb", badge)}>{badge}</span>
            <span className="nh-deck-recnote">{recNote}</span>
          </div>
        )}
        {premium && recNote && !isCandidate && (
          <div className="nh-deck-recnote nh-deck-premium-note">{recNote}</div>
        )}
        {distLine && !isCondor && !isCandidate && (
          <div className="nh-deck-dist" title="Distance from live mark to plan rails">
            <span className="k">Rails</span>
            <span className="v">{distLine}</span>
          </div>
        )}
        {hasEntry && !isCandidate && (
          <TradeExcursionGraphic play={play} markFlash={markFlash} />
        )}
        {showsTimeStopClock(play) && <TimeStopClock nowMs={nowMs} />}
        {isCondor && <CondorPanel play={play} />}
        {showsRatchetTrack(play) && !isCandidate && (
          <>
            <div className="nh-deck-track">
              <span className="lo">STOP −50%</span>
              <span className="hi">TARGET +100%</span>
              <span className="mk" style={{ left: `${Math.round((mgmt.progress ?? 0) * 100)}%` }} />
            </div>
            <div className="nh-deck-recnote">
              Ratchet: fast 0DTE exit — marker = distance stop→target.
            </div>
          </>
        )}
        {showsTrimScaleLadder(play) && !premium && !isCandidate && (
          <div className="nh-deck-recnote">Trim-scale ladder active — see frozen policy on board.</div>
        )}
      </section>

      <details className="nh-deck-command-technicals" open={technicalsOpen}>
        <summary className="nh-deck-command-heading">Technicals · gates · factors</summary>
        <div className="nh-deck-command-technicals__body">
          {premium && <ThesisExpectedMove play={play} />}
          {play.gates.length > 0 && (
            <>
              <div className="nh-deck-lab">Gates at commit</div>
              <div className="nh-deck-gaterow">
                {play.gates.map((g) => (
                  <span key={g.label} className={clsx("nh-deck-gate", g.ok ? "ok" : "no")}>
                    {g.ok ? "✓" : "✗"} {g.label}
                  </span>
                ))}
              </div>
            </>
          )}
          {play.factors.length > 0 && (
            <details className="nh-deck-why" open={play.factors.length <= 2}>
              <summary className="nh-deck-lab nh-deck-why-sum">
                Factor breakdown
                <span className="nh-deck-why-n"> · {play.factors.length} factors</span>
              </summary>
              {topFactors.map((f) => (
                <div key={f.label} className={clsx("nh-deck-fac", f.points < 0 && "neg")}>
                  <div>
                    {f.label}
                    {f.points > 0 && <Bar pts={f.points} />}
                  </div>
                  <div className="pts">
                    {f.points > 0 ? "+" : ""}
                    {f.points}
                  </div>
                </div>
              ))}
              {moreFactors.length > 0 && (
                <details className="nh-deck-why-more">
                  <summary className="nh-deck-recnote">Show {moreFactors.length} more factors</summary>
                  {moreFactors.map((f) => (
                    <div key={f.label} className={clsx("nh-deck-fac", f.points < 0 && "neg")}>
                      <div>
                        {f.label}
                        {f.points > 0 && <Bar pts={f.points} />}
                      </div>
                      <div className="pts">
                        {f.points > 0 ? "+" : ""}
                        {f.points}
                      </div>
                    </div>
                  ))}
                </details>
              )}
            </details>
          )}
          {play.thesis && (
            <div className="nh-deck-recnote nh-deck-command-thesis-prose">{play.thesis}</div>
          )}
          {play.keySignal && (
            <div className="nh-deck-recnote">Key signal: {play.keySignal}</div>
          )}
          <div className="nh-deck-meta nh-deck-command-meta">
            {play.regime && (
              <div>
                <span className="k">Regime</span>
                <span className="v">{play.regime}</span>
              </div>
            )}
            {play.rrRatio != null && (
              <div>
                <span className="k">Risk : Reward</span>
                <span
                  className={clsx(
                    "v",
                    play.rrRatio >= 2 && "nh-deck-pos",
                    play.rrRatio < 1 && "nh-deck-neg",
                  )}
                >
                  {play.rrRatio.toFixed(1)}:1
                </span>
              </div>
            )}
            {play.peak != null && (
              <div>
                <span className="k">Peak</span>
                <span className="v nh-deck-pos">{signPct(play.peak)}</span>
              </div>
            )}
            {play.trough != null && (
              <div>
                <span className="k">Trough</span>
                <span className="v nh-deck-neg">{signPct(play.trough)}</span>
              </div>
            )}
          </div>
        </div>
      </details>

      <details className="nh-deck-command-log">
        <summary className="nh-deck-command-heading">Session log</summary>
        <PlayTimelinePanel play={play} nowMs={nowMs} />
      </details>
    </div>
  );
}
