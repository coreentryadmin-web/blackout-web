"use client";

import { clsx } from "clsx";
import type { TerminalPlay } from "./types";
import { targetReachabilityNote } from "@/features/nighthawk/lib/target-reachability";
import { formatPremiumCapLabel } from "@/features/nighthawk/lib/play-constraints";
import { MAX_OPTION_PREMIUM_PER_SHARE } from "@/features/nighthawk/lib/constants";
import { dispatchGotoSwing } from "@/features/nighthawk/lib/goto-swing";
import { ThesisChecklistPanel, TradeExcursionGraphic } from "./TerminalPremiumPanels";
import { LegacyManageGeometry } from "./legacy-play-geometry";
import { useFlash } from "./use-deck-live";

const usd = (n: number | null | undefined): string => (n != null ? `$${n.toFixed(2)}` : "—");

function Bar({ pts }: { pts: number }) {
  const w = Math.max(2, Math.min(100, (Math.abs(pts) / 30) * 100));
  return (
    <div className="bar">
      <i style={{ width: `${w}%` }} />
    </div>
  );
}

function morningHeadline(play: TerminalPlay): string | null {
  const ms = play.morningStatus;
  if (!ms) return null;
  if (ms === "CONFIRMED") return "Pre-market confirmed — entry levels held";
  if (ms === "DEGRADED") return "Pre-market degraded — validate before entry";
  if (ms === "INVALIDATED") return "Invalidated at pre-market screening";
  if (ms === "UNVERIFIED") return "Morning confirm not run yet";
  return null;
}

function whyPickedSummary(play: TerminalPlay): string {
  if (play.thesis?.trim()) return play.thesis.trim();
  if (play.keySignal?.trim()) return play.keySignal.trim();
  if (play.recNote?.trim()) return play.recNote.trim();
  return "Evening scan ranked this setup from flow, technicals, and positioning — see factor breakdown below.";
}

/** Legacy command deck v2 — single scroll: why picked, what to watch, contract, risks. */
export function LegacyPlayDetailPanel({ play }: { play: TerminalPlay }) {
  const markFlash = useFlash(play.stockMovePct ?? play.pnlPct ?? null);
  const movePct = play.stockMovePct ?? play.pnlPct ?? null;
  const dayChg = play.stockChangePct;
  const spot = play.stockPrice;
  const reachability =
    play.targetAtrMultiple != null ? targetReachabilityNote(play.targetAtrMultiple) : null;
  const topFactors = [...play.factors]
    .filter((f) => f.points !== 0)
    .sort((a, b) => Math.abs(b.points) - Math.abs(a.points))
    .slice(0, 5);
  const morningLine = morningHeadline(play);
  const thesisNote = play.thesisBreak?.note;
  const showRisk =
    play.gates.length > 0 ||
    (play.thesisBreak?.level === "warn" && thesisNote) ||
    play.premiumCapOk === false;
  const technicalsOpen = play.status === "WATCH" || play.status === "SKIP" || play.factors.length <= 3;

  return (
    <div className="nh-deck-command-panel nh-deck-command-panel-v2 nh-deck-body nh-deck-legacy-panel">
      <div className="nh-deck-verdict-band" aria-label="Verdict">
        <span className={clsx("nh-deck-verdict-band__rec", `is-${play.recommendation.toLowerCase()}`)}>
          {play.recommendation}
        </span>
        {spot != null && (
          <span className="nh-deck-verdict-band__pnl">
            ${spot.toFixed(2)}
            {movePct != null && (
              <span
                className={clsx(
                  movePct > 0 && "nh-deck-pos",
                  movePct < 0 && "nh-deck-neg",
                  markFlash && "neon",
                )}
              >
                {" "}
                {movePct >= 0 ? "+" : ""}
                {movePct.toFixed(1)}% from entry
              </span>
            )}
            {movePct == null && dayChg != null && (
              <span className={clsx(dayChg > 0 && "nh-deck-pos", dayChg < 0 && "nh-deck-neg")}>
                {" "}
                {dayChg >= 0 ? "+" : ""}
                {dayChg.toFixed(1)}% today
              </span>
            )}
          </span>
        )}
        {play.recNote && <span className="nh-deck-verdict-band__thesis">{play.recNote}</span>}
      </div>

      <section className="nh-deck-command-section" aria-labelledby="nh-legacy-why">
        <h3 id="nh-legacy-why" className="nh-deck-command-heading">
          Why we picked it
        </h3>
        <p className="nh-deck-command-thesis-prose">{whyPickedSummary(play)}</p>
        <ul className="nh-deck-legacy-bullets">
          {play.rank != null && play.rank > 0 && (
            <li>
              Ranked <strong>#{play.rank}</strong>
              {play.score > 0 ? (
                <>
                  {" "}
                  with desk score <strong>{play.score}</strong>
                </>
              ) : null}
              {play.tierLabel ? (
                <>
                  {" "}
                  · tier <strong>{play.tierLabel}</strong>
                </>
              ) : null}
              {play.confluence != null ? (
                <>
                  {" "}
                  · <strong>{play.confluence}</strong> confirming signals
                </>
              ) : null}
            </li>
          )}
          {play.direction && (
            <li>
              Direction: <strong>{play.direction}</strong>
              {play.regime ? <> · {play.regime}</> : null}
            </li>
          )}
          {topFactors.map((f) => (
            <li key={f.label} className={clsx(f.points < 0 && "is-neg")}>
              <span>{f.label}</span>
              {f.points > 0 && <Bar pts={f.points} />}
              <strong>
                {f.points > 0 ? "+" : ""}
                {f.points}
              </strong>
            </li>
          ))}
          {topFactors.length === 0 && play.score > 0 && (
            <li>Composite score {play.score} — factor breakdown not pinned on this edition.</li>
          )}
        </ul>
        <ThesisChecklistPanel play={play} />
      </section>

      <section className="nh-deck-command-section" aria-labelledby="nh-legacy-watch">
        <h3 id="nh-legacy-watch" className="nh-deck-command-heading">
          What to watch
        </h3>
        <LegacyManageGeometry play={play} />
        {reachability && <p className="nh-deck-recnote nh-deck-legacy-reach">{reachability}</p>}
        {play.rrRatio != null && (
          <div className="nh-deck-meta nh-deck-command-meta">
            <div>
              <span className="k">Risk : reward</span>
              <span
                className={clsx(
                  "v",
                  play.rrRatio >= 2 && "nh-deck-pos",
                  play.rrRatio < 1 && "nh-deck-neg",
                )}
              >
                {play.rrRatio.toFixed(1)}:1
                {play.rrRatio >= 2 ? " (strong)" : play.rrRatio >= 1 ? " (favorable)" : " (tight)"}
              </span>
            </div>
          </div>
        )}
        {(play.stockPeakPct != null || play.stockTroughPct != null) && (
          <TradeExcursionGraphic play={play} markFlash={markFlash} />
        )}
      </section>

      <section className="nh-deck-command-section" aria-labelledby="nh-legacy-contract">
        <h3 id="nh-legacy-contract" className="nh-deck-command-heading">
          How to express it
        </h3>
        {play.optionsPlay ? (
          <p className="nh-deck-command-contract">{play.optionsPlay}</p>
        ) : (
          <p className="nh-deck-recnote">No option contract pinned — stock-level plan only.</p>
        )}
        <div className="nh-deck-meta nh-deck-command-meta">
          {play.entry != null && (
            <div>
              <span className="k">Stock entry</span>
              <span className="v">{usd(play.entry)}</span>
            </div>
          )}
          {play.entryCostPerContract != null && (
            <div>
              <span className="k">Option premium</span>
              <span className="v">{usd(play.entryCostPerContract)}/sh</span>
            </div>
          )}
          {play.ivRank != null && (
            <div>
              <span className="k">IV rank</span>
              <span className="v">{Math.round(play.ivRank)}</span>
            </div>
          )}
          <div>
            <span className="k">Premium cap</span>
            <span className={clsx("v", play.premiumCapOk !== false ? "nh-deck-pos" : "nh-deck-neg")}>
              {formatPremiumCapLabel(play.entryCostPerContract ?? null) ??
                `≤$${MAX_OPTION_PREMIUM_PER_SHARE}/sh`}
              {play.premiumCapOk === false ? " · above cap" : ""}
            </span>
          </div>
        </div>
      </section>

      {morningLine && (
        <section className="nh-deck-command-section" aria-labelledby="nh-legacy-premarket">
          <h3 id="nh-legacy-premarket" className="nh-deck-command-heading">
            Pre-market check
          </h3>
          <p
            className={clsx(
              "nh-deck-legacy-verdict",
              play.morningStatus === "CONFIRMED" && "is-ok",
              play.morningStatus === "DEGRADED" && "is-warn",
              (play.morningStatus === "INVALIDATED" || play.status === "SKIP") && "is-brk",
            )}
          >
            {morningLine}
          </p>
          {thesisNote && play.morningStatus !== "CONFIRMED" && (
            <p className="nh-deck-recnote">{thesisNote}</p>
          )}
          {play.swingPromoted && (
            <button
              type="button"
              className="nh-deck-recnote nh-deck-swing-promoted-link"
              style={{
                display: "block",
                marginTop: 6,
                textAlign: "left",
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                textDecoration: "underline",
                color: "var(--dk-green)",
              }}
              onClick={() => dispatchGotoSwing(play.ticker)}
              title="Jump to this ticker's row on the Swing board"
            >
              Active on Swings Open →
            </button>
          )}
        </section>
      )}

      <details className="nh-deck-command-technicals" open={showRisk || technicalsOpen}>
        <summary className="nh-deck-command-heading">Risks · gates · scoring</summary>
        <div className="nh-deck-command-technicals__body">
          {play.gates.length > 0 ? (
            <>
              <div className="nh-deck-lab">Gate caveats</div>
              <div className="nh-deck-gaterow">
                {play.gates.map((g) => (
                  <span key={g.label} className={clsx("nh-deck-gate", g.ok ? "ok" : "no")}>
                    {g.ok ? "✓" : "✗"} {g.label}
                  </span>
                ))}
              </div>
              <p className="nh-deck-recnote">
                Promoted plays cleared the funnel as best available — validate levels before sizing.
              </p>
            </>
          ) : (
            <p className="nh-deck-recnote nh-deck-pos">Cleared standard publish gates.</p>
          )}
          {play.thesisBreak?.level === "warn" && thesisNote && play.morningStatus !== "DEGRADED" && (
            <p className="nh-deck-recnote">{thesisNote}</p>
          )}
          {play.factors.length > topFactors.length && (
            <details className="nh-deck-why" open={false}>
              <summary className="nh-deck-lab nh-deck-why-sum">
                Full factor breakdown
                <span className="nh-deck-why-n"> · {play.factors.length} factors</span>
              </summary>
              {play.factors.map((f) => (
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
        </div>
      </details>
    </div>
  );
}
