"use client";

import { useEffect, useState } from "react";
import { clsx } from "clsx";
import type { TerminalPlay } from "./types";
import { timeStopClock } from "@/lib/zerodte/terminal-ladder";
import { zerodteTimeStopEtLabel } from "@/lib/zerodte/plan";
import { isZeroDteMarkStale, ZERODTE_MARK_STALE_MS, LEGACY_QUOTE_STALE_MS } from "@/lib/zerodte/marks-math";
import { condorTent } from "@/lib/zerodte/condor-render";
import { etNowParts } from "@/features/nighthawk/lib/session";
import { dispatchGotoSwing } from "@/features/nighthawk/lib/goto-swing";
import { ThesisRankCard } from "@/features/nighthawk/components/ThesisRankCard";
import { showsTimeStopClock, showsTrimScaleLadder } from "./terminal-guards";
import { managementFor } from "./adapters";
import type { DeckCondor } from "./types";
import { markStreamKind } from "./deck-session-ui";
import { PlayTimelinePanel } from "./PlayTimelinePanel";
import { useSecondTick, useFlash } from "./use-deck-live";
import { isZeroDtePremiumTerminal, swingStatusLine } from "./terminal-display";
import type { ConvictionRankContext } from "./deck-command-center";
import {
  ManagementActionCard,
  MarketContextRow,
  TradeExcursionGraphic,
  ThesisChecklistPanel,
  ThesisExpectedMove,
  TradeOutcomePanel,
  TradeSummaryHero,
  VisualTrimLadder,
} from "./TerminalPremiumPanels";

type Tab = "thesis" | "manage" | "pnl" | "timeline";

const GLAB: Record<string, string> = {
  delta: "Δ DELTA", gamma: "Γ GAMMA", theta: "Θ THETA", vega: "V VEGA", iv: "IV",
};

function fmtGreek(k: string, v: number | null): string {
  if (v == null) return "—";
  if (k === "iv") return `${Math.round(v * 100)}%`;
  if (k === "theta") return v.toFixed(2);
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;
}

const usd = (n: number | null | undefined): string => (n != null ? `$${n.toFixed(2)}` : "—");
const signPct = (n: number | null | undefined): string => (n != null ? `${n > 0 ? "+" : ""}${Math.round(n)}%` : "—");

function formatScorecardHint(s: { avg: number; n: number; scope?: "conviction_bucket" | "play" }): string {
  const n = Number.isFinite(s.n) ? s.n : 0;
  const bucket = s.scope === "conviction_bucket" ? " · tier bucket" : "";
  return `${signPct(s.avg)} avg · n=${n}${bucket}`;
}

/** ET wall-clock (HH:MM) of an ISO instant, for the why-now ribbon (and the deck row's entry-time
 *  chip — CommandDeck.tsx imports this rather than duplicating the tz-safe parse). Formats in
 *  America/New_York regardless of the instant's stored offset (a DB row may be UTC).
 *  Null/unparseable → null. */
export function etClock(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(ms);
  } catch {
    return null;
  }
}

/** One-tap OCC copy control on the contract label — copies the exact OCC symbol to the clipboard.
 *  Pure client, accessible (real button, keyboard-focusable, aria-label, "Copied" feedback).
 *  Renders nothing when no OCC is on the row (graceful absence — never a dead/empty control). */
function OccCopy({ occ }: { occ: string | null | undefined }) {
  const [copied, setCopied] = useState(false);
  if (!occ) return null;
  const copy = () => {
    // navigator.clipboard is unavailable in insecure/legacy contexts — fail silently, never throw.
    void navigator.clipboard?.writeText(occ).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  };
  return (
    <button
      type="button"
      className={clsx("nh-deck-occcopy", copied && "done")}
      onClick={copy}
      aria-label={copied ? `Copied OCC symbol ${occ}` : `Copy OCC symbol ${occ}`}
      title={occ}
    >
      {copied ? "✓ copied" : "⧉ OCC"}
    </button>
  );
}

/** Flash a cell when its value changes between renders — skip the first paint so mount doesn't
 *  neon-flash every static number (honest live-change feedback only). */
function GreekCell({ k, v }: { k: string; v: number | null }) {
  const flash = useFlash(v);
  // THETA is the 0DTE enemy — always highlight it (amber) so the decay cost reads at a glance;
  // a negative delta (a put's directional delta) still renders red.
  const theta = k === "theta";
  const neg = !theta && k === "delta" && (v ?? 0) < 0;
  return (
    <div className="nh-deck-gk">
      <div className="gl">{GLAB[k]}</div>
      <div className={clsx("gv", theta && "th", neg && "dn", flash && "neon")}>{fmtGreek(k, v)}</div>
    </div>
  );
}

function Bar({ pts }: { pts: number }) {
  const w = Math.max(2, Math.min(100, (Math.abs(pts) / 30) * 100));
  return <div className="bar"><i style={{ width: `${w}%` }} /></div>;
}

/** ⅓ / ½ etc — a compact fraction glyph for a tranche's share of the original position. */
function fractionGlyph(f: number): string {
  const map: Record<string, string> = { "0.33": "⅓", "0.34": "⅓", "0.50": "½", "0.25": "¼", "0.67": "⅔", "1.00": "ALL" };
  return map[f.toFixed(2)] ?? `${Math.round(f * 100)}%`;
}

export function PlayTerminal({
  play,
  sessionClosed = false,
  nowMs: nowMsProp,
  convictionRank = null,
  initialTab,
}: {
  play: TerminalPlay | null;
  /** Board heat.state === CLOSED — right-rail must not claim LIVE/greeks after the session. */
  sessionClosed?: boolean;
  /**
   * Optional shared clock from a parent that already runs its own useSecondTick (e.g. CommandDeck) —
   * avoids a second, unsynchronized 1s setInterval ticking alongside the parent's when both mount
   * together. Falls back to this component's own tick so standalone callers are unaffected.
   */
  nowMs?: number;
  /** Engine conviction rank on today's full board (0DTE command deck). */
  convictionRank?: ConvictionRankContext | null;
  /** Test-only escape hatch: SSR renders whatever tab is selected at mount, and the real tab-switch
   *  effect (0DTE OPEN/HOLD/TRIM → Management) never runs under renderToStaticMarkup — there's no
   *  click simulation in that harness. Lets PlayTerminal.ssr.test.ts assert on Management/PnL tab
   *  markup (e.g. the Legacy stop/target dedup) without a DOM. Omit in real usage — defaults to
   *  the normal "thesis" first paint. */
  initialTab?: Tab;
}) {
  // Default to Management for working 0DTE rows (action first); Thesis otherwise.
  const [tab, setTab] = useState<Tab>(initialTab ?? "thesis");
  const [tabTouched, setTabTouched] = useState(false);
  useEffect(() => {
    if (tabTouched || !play || play.horizon === "ZERO_DTE") return;
    if (play.status === "OPEN" || play.status === "HOLD" || play.status === "TRIM") {
      setTab("manage");
    }
  }, [play, tabTouched]);
  useEffect(() => {
    if (play?.horizon === "ZERO_DTE") return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "1") { setTabTouched(true); setTab("thesis"); }
      else if (e.key === "2") { setTabTouched(true); setTab("manage"); }
      else if (e.key === "3") { setTabTouched(true); setTab("pnl"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [play?.horizon]);
  // Hooks must run unconditionally (before any early return). Pause the internal tick when a
  // parent already supplies one (see the nowMs prop doc above) — the hook stays mounted (rules of
  // hooks) but its own setInterval never fires, so only one 1Hz timer runs for the whole deck.
  const markFlash = useFlash(play?.mark ?? null);
  const stockFlash = useFlash(play?.stockPrice ?? null);
  const internalNowMs = useSecondTick(nowMsProp === undefined);
  const nowMs = nowMsProp ?? internalNowMs;

  if (!play) {
    return <div className="nh-deck-right"><div className="nh-deck-empty">◂ select a play to break it down</div></div>;
  }
  const g = play.greeks;
  // A CONDOR is a CREDIT structure closed by BUYING back — the directional "sell into the BID" fill
  // (a long-premium framing) is inverted for it, so the executable-fill lines are suppressed on condor
  // rows across the terminal. Its P&L IS the premium decay (pnlPct), which stays honest.
  const isCondor = play.isCondor === true;

  // ── Honest liveliness: the mark is LIVE only when it carries a fresh per-quote timestamp. A
  //    legacy SYNC mark (no timestamp) is unknown-age; a timestamp older than the stale window is
  //    STALE. We NEVER render a stale/sync mark under a confident green "LIVE" pulse. ──
  const asOfMs = play.markAsOf ? Date.parse(play.markAsOf) : NaN;
  const hasAsOf = Number.isFinite(asOfMs);
  const ageMs = hasAsOf ? Math.max(0, nowMs - asOfMs) : null;
  const isLegacy = play.horizon === "LEGACY";
  const staleThresholdMs = isLegacy ? LEGACY_QUOTE_STALE_MS : ZERODTE_MARK_STALE_MS;
  const stale = hasAsOf ? isZeroDteMarkStale(asOfMs, nowMs, staleThresholdMs) : false;
  const sync = play.markIsSync === true || (!hasAsOf && play.mark != null);
  const live = play.mark != null && hasAsOf && !stale;
  const streamKind = markStreamKind({
    live,
    sync,
    stale,
    playClosed: play.status === "CLOSED",
    sessionClosed: sessionClosed && play.horizon === "ZERO_DTE",
    hasMark: play.mark != null,
  });
  const ageLabel =
    ageMs == null
      ? null
      : ageMs < 1000
        ? "now"
        : ageMs < 60_000
          ? `${Math.round(ageMs / 1000)}s ago`
          : `${Math.round(ageMs / 60_000)}m ago`;
  const greeksLive = Boolean(
    g && (g.delta != null || g.gamma != null || g.theta != null || g.vega != null || g.iv != null),
  );
  const greeksOff = !live || !greeksLive || streamKind === "CLOSED";
  const premium = isZeroDtePremiumTerminal(play);
  const zeroDteSinglePanel = play.horizon === "ZERO_DTE";

  return (
    <div className={clsx("nh-deck-right", premium && "nh-deck-right-premium", (stale || streamKind === "CLOSED") && "nh-deck-dim")}>
      {premium ? (
        <>
          <TradeSummaryHero
            play={play}
            streamKind={streamKind}
            markFlash={markFlash}
            rankContext={convictionRank}
            nowMs={nowMs}
          />
          <div className="nh-deck-stream nh-deck-stream-compact" title={streamKind === "CLOSED" ? "Session closed — showing last known marks" : undefined}>
            {streamKind === "LIVE" ? (
              <><span className="nh-deck-dot" /><span className="lv">LIVE</span></>
            ) : streamKind === "CLOSED" ? (
              <><span className="nh-deck-dot off" /><span className="cl">SESSION CLOSED</span></>
            ) : streamKind === "SYNC" ? (
              <><span className="nh-deck-dot sync" /><span className="sy">SYNC</span></>
            ) : streamKind === "STALE" ? (
              <><span className="nh-deck-dot off" /><span className="of">STALE</span></>
            ) : (
              <><span className="nh-deck-dot off" /><span className="of">—</span></>
            )}
            {" · mark "}
            <span className={clsx(markFlash && "neon", (stale || streamKind === "CLOSED") && "nh-deck-stale-mark")}>{usd(play.mark)}</span>
            {play.occ && <OccCopy occ={play.occ} />}
            {streamKind === "LIVE" && ageLabel && <span className="nh-deck-age"> · {ageLabel}</span>}
          </div>
        </>
      ) : (
        <>
      <div className="nh-deck-th">
        <span className="tk">{play.ticker} · {play.direction}</span>
        <span className="ct">{play.contract}<OccCopy occ={play.occ} /></span>
        <span className="nh-deck-cursor" aria-hidden />
        <span className="big"><div className="nh-deck-score">{play.score}</div><div className="lab">SCORE</div></span>
      </div>

      <HeaderBadges play={play} />

      {play.horizon === "LEGACY" ? (
        <div className="nh-deck-stream">
          {play.stockPrice != null ? (
            <>
              {stale ? (
                <><span className="nh-deck-dot off" /><span className="of">STALE</span></>
              ) : (
                <><span className="nh-deck-dot" /><span className="lv">LIVE</span></>
              )}
              {" · "}{play.ticker}{" "}
              <span className={clsx((markFlash || stockFlash) && "neon", stale && "nh-deck-stale-mark")}>${play.stockPrice.toFixed(2)}</span>
              {play.pnlPct != null ? (
                <span className={clsx(play.pnlPct > 0 ? "nh-deck-pos" : play.pnlPct < 0 ? "nh-deck-neg" : "")}>
                  {" "}{play.pnlPct >= 0 ? "+" : ""}{play.pnlPct.toFixed(1)}% from entry
                </span>
              ) : play.stockChangePct != null ? (
                <span className={clsx(play.stockChangePct > 0 ? "nh-deck-pos" : play.stockChangePct < 0 ? "nh-deck-neg" : "")}>
                  {" "}{play.stockChangePct >= 0 ? "+" : ""}{play.stockChangePct.toFixed(1)}%
                </span>
              ) : null}
              {ageLabel && <span className="nh-deck-age"> · {ageLabel}</span>}
              {stale && <span className="nh-deck-stalebadge">stale &gt;{Math.round(LEGACY_QUOTE_STALE_MS / 1000)}s</span>}
            </>
          ) : (
            <>
              <span className="nh-deck-dot off" /><span className="of">PENDING</span>
              {" · stock quote polling"}
            </>
          )}
          {play.entry != null && <span className="nh-deck-fill"> · entry prem {usd(play.entry)}</span>}
        </div>
      ) : (
        <div className="nh-deck-stream" title={streamKind === "CLOSED" ? "Session closed — showing last known marks" : undefined}>
          {streamKind === "LIVE" ? (
            <><span className="nh-deck-dot" /><span className="lv">LIVE</span></>
          ) : streamKind === "CLOSED" ? (
            <><span className="nh-deck-dot off" /><span className="cl">SESSION CLOSED</span></>
          ) : streamKind === "SYNC" ? (
            <><span className="nh-deck-dot sync" /><span className="sy">SYNC</span></>
          ) : streamKind === "STALE" ? (
            <><span className="nh-deck-dot off" /><span className="of">STALE</span></>
          ) : (
            <><span className="nh-deck-dot off" /><span className="of">—</span></>
          )}
          {!isCondor && play.stockPrice != null && (
            <>{" · "}{play.ticker}{" "}
              <span className={clsx(stockFlash && "neon")}>${play.stockPrice.toFixed(2)}</span>
            </>
          )}
          {" · mark "}
          <span className={clsx(markFlash && "neon", (stale || streamKind === "CLOSED") && "nh-deck-stale-mark")}>{usd(play.mark)}</span>
          {!isCondor && play.execMark != null && streamKind === "LIVE" && (
            <span className="nh-deck-fill"> · fill ≈{usd(play.execMark)}</span>
          )}
          {streamKind === "CLOSED" && (
            <span className="nh-deck-age"> · last known{ageLabel ? ` · ${ageLabel}` : ""}</span>
          )}
          {streamKind === "SYNC" && <span className="nh-deck-age"> · last known</span>}
          {streamKind === "LIVE" && ageLabel && <span className="nh-deck-age"> · {ageLabel}</span>}
          {streamKind === "STALE" && (
            <span className="nh-deck-stalebadge">stale &gt;{Math.round(ZERODTE_MARK_STALE_MS / 1000)}s</span>
          )}
        </div>
      )}
        </>
      )}

      {!isLegacy && !premium && (
        <div className={clsx("nh-deck-greeks", greeksOff && "off")} title={greeksOff ? "Greeks update with live marks — offline after the session" : undefined}>
          <GreekCell k="delta" v={greeksOff ? null : (g?.delta ?? null)} />
          <GreekCell k="gamma" v={greeksOff ? null : (g?.gamma ?? null)} />
          <GreekCell k="theta" v={greeksOff ? null : (g?.theta ?? null)} />
          <GreekCell k="vega" v={greeksOff ? null : (g?.vega ?? null)} />
          <GreekCell k="iv" v={greeksOff ? null : (g?.iv ?? null)} />
        </div>
      )}

      {premium && (greeksOff ? <MarketContextRow play={play} /> : (
        <div className={clsx("nh-deck-greeks", greeksOff && "off")} title={greeksOff ? "Greeks update with live marks" : undefined}>
          <GreekCell k="delta" v={g?.delta ?? null} />
          <GreekCell k="gamma" v={g?.gamma ?? null} />
          <GreekCell k="theta" v={g?.theta ?? null} />
          <GreekCell k="vega" v={g?.vega ?? null} />
          <GreekCell k="iv" v={g?.iv ?? null} />
        </div>
      ))}

      {zeroDteSinglePanel ? (
        <ZeroDteCommandPanel play={play} nowMs={nowMs} sessionClosed={sessionClosed} />
      ) : (
        <>
          <div className="nh-deck-tabs">
            <button className={clsx(tab === "thesis" && "on")} onClick={() => { setTabTouched(true); setTab("thesis"); }}><span className="n">[1]</span>Thesis</button>
            <button className={clsx(tab === "manage" && "on")} onClick={() => { setTabTouched(true); setTab("manage"); }}><span className="n">[2]</span>Management</button>
            <button className={clsx(tab === "pnl" && "on")} onClick={() => { setTabTouched(true); setTab("pnl"); }}><span className="n">[3]</span>PnL</button>
          </div>

          <div className="nh-deck-body">
            {tab === "thesis" && <ThesisPanel play={play} sessionClosed={sessionClosed} />}
            {tab === "manage" && <ManagePanel play={play} nowMs={nowMs} />}
            {tab === "pnl" && <PnlPanel play={play} />}
          </div>
        </>
      )}

      <div className="nh-deck-foot">
        <span>EXIT · {play.exitModel === "SCALE_OUT" ? "TRIM-SCALE" : play.horizon === "LEGACY" ? "STOCK LEVELS" : play.exitModel}</span>
        <span>{play.tierLabel ? `TIER ${play.tierLabel}` : play.scorecard ? formatScorecardHint(play.scorecard) : ""}</span>
        {play.allocation && <span style={{ marginLeft: "auto" }}>{play.allocation.role} · {play.allocation.sizing}</span>}
      </div>
    </div>
  );
}

/** Tier · confluence · discovery-origin header badges + the calibration scorecard line (shown ONLY
 *  when the payload carries a real figure — never fabricated). Renders nothing when a play carries
 *  none of them (a legacy row), so the header stays clean. */
/** 0DTE Command: one scroll — why picked, live management, P&L, collapsible session log. */
function ZeroDteCommandPanel({
  play,
  nowMs,
  sessionClosed = false,
}: {
  play: TerminalPlay;
  nowMs: number;
  sessionClosed?: boolean;
}) {
  return (
    <div className="nh-deck-command-panel nh-deck-body">
      <section className="nh-deck-command-section" aria-labelledby="nh-cmd-why">
        <h3 id="nh-cmd-why" className="nh-deck-command-heading">Why we picked it</h3>
        <ThesisPanel play={play} sessionClosed={sessionClosed} />
      </section>

      <section className="nh-deck-command-section" aria-labelledby="nh-cmd-live">
        <h3 id="nh-cmd-live" className="nh-deck-command-heading">Live · management</h3>
        <ManagePanel play={play} nowMs={nowMs} />
      </section>

      <section className="nh-deck-command-section" aria-labelledby="nh-cmd-pnl">
        <h3 id="nh-cmd-pnl" className="nh-deck-command-heading">P&amp;L · excursion</h3>
        <PnlPanel play={play} />
      </section>

      <details className="nh-deck-command-log">
        <summary className="nh-deck-command-heading">Session log</summary>
        <PlayTimelinePanel play={play} nowMs={nowMs} />
      </details>
    </div>
  );
}

function HeaderBadges({ play }: { play: TerminalPlay }) {
  const hasBadges = play.tierLabel || play.confluence != null || (play.discoveryOrigin?.length ?? 0) > 0 || play.sector || play.morningStatus;
  if (!hasBadges && !play.scorecard) return null;
  return (
    <>
      {play.morningStatus && (
        <div className={clsx(
          "nh-deck-verdict",
          play.morningStatus === "CONFIRMED" ? "verdict-ok"
          : play.morningStatus === "DEGRADED" ? "verdict-warn"
          : play.morningStatus === "INVALIDATED" ? "verdict-brk"
          : "verdict-pending",
        )}>
          {play.morningStatus === "CONFIRMED" ? "PRE-MARKET CONFIRMED"
          : play.morningStatus === "DEGRADED" ? "PRE-MARKET DEGRADED"
          : play.morningStatus === "INVALIDATED" ? "INVALIDATED"
          : "MORNING CONFIRM PENDING"}
        </div>
      )}
      <div className="nh-deck-badges">
      {play.sector && <span className="nh-deck-badge sector">{play.sector.toUpperCase()}</span>}
      {play.tierLabel && <span className="nh-deck-badge tier">TIER {play.tierLabel}</span>}
      {play.confluence != null && <span className="nh-deck-badge conf">CONFLUENCE {play.confluence}{play.horizon === "LEGACY" ? "" : "/2"}</span>}
      {play.discoveryOrigin?.map((o) => (
        <span key={o} className="nh-deck-badge orig">{o}</span>
      ))}
      {play.scorecard && (
        <span
          className="nh-deck-badge sc"
          title={
            play.scorecard.scope === "conviction_bucket"
              ? `Historical average return for all ${play.tierLabel ?? "this tier"}-tier plays (n=${play.scorecard.n}) — not this play alone`
              : "Calibrated strategy average return (sample size)"
          }
        >
          {formatScorecardHint(play.scorecard)}
        </span>
      )}
    </div>
    </>
  );
}

function ThesisPanel({ play, sessionClosed = false }: { play: TerminalPlay; sessionClosed?: boolean }) {
  const level = play.thesisBreak?.level ?? "intact";
  const broke = level === "warn" || level === "break";
  const unknown = level === "unknown";
  const liveRec = play.recommendation;
  const whyAt = etClock(play.firstFlaggedAt);
  const topFactors = play.factors.slice(0, 2);
  const moreFactors = play.factors.slice(2);
  const hasThesisHealth = play.horizon === "ZERO_DTE" && play.thesisHealth != null;
  const premium = isZeroDtePremiumTerminal(play);
  const isWorking =
    play.status === "OPEN" || play.status === "HOLD" || play.status === "TRIM";
  const monitorTitle =
    play.status === "CLOSED" || sessionClosed
      ? "◉ THESIS (SESSION CLOSED)"
      : hasThesisHealth
        ? "◉ THESIS LIFECYCLE"
        : "◉ THESIS MONITOR";
  const monitorNote = hasThesisHealth
    ? play.thesisHealth!.advisory
    : broke
      ? null
      : unknown
        ? null
        : play.horizon === "LEGACY"
          ? play.regime?.includes("CONFIRMED")
            ? "pre-market confirmed — entry levels validated."
            : "evening thesis holds; morning confirmation updates before the open."
          : sessionClosed || play.status === "CLOSED"
            ? "frozen at close — gates/factors are the last board read, not a live stream."
            : "tape alignment from the board poll; mark/P&L from the marks stream.";

  // Swing-only: the pre-entry/live observables the serving router (serving.ts) already keys on to
  // place this name in a section (COMMIT_NOW/WAITING_FOR_ENTRY/WATCH/…) — surfaced here as the
  // honest "why is this still WATCH" a member asks when a high-scoring name isn't actionable yet.
  const swingLine = swingStatusLine(play);

  const commitSnapshot = (
    <>
      {swingLine && (
        <div className="nh-deck-recnote" style={{ opacity: 0.8, marginBottom: 6 }} title="Pre-entry setup maturity, entry-execution stance, and the serving section this name resolved to">
          {swingLine}
        </div>
      )}
      {play.whyNow && (
        <div className="nh-deck-whynow" title="The event-driven scan trigger that surfaced this play">
          <span className="ic" aria-hidden>⚡</span>
          <span className="lb">triggered by:</span>
          <span className="rs">{play.whyNow.label}</span>
          {whyAt && <span className="at"> · {whyAt} ET</span>}
        </div>
      )}
      {play.gates.length > 0 && (
        <>
          <div className="nh-deck-lab">Gates at commit</div>
          <div className="nh-deck-gaterow">
            {play.gates.map((g) => (
              <span key={g.label} className={clsx("nh-deck-gate", g.ok ? "ok" : "no")}>{g.ok ? "✓" : "✗"} {g.label}</span>
            ))}
          </div>
        </>
      )}
      <details className="nh-deck-why" open={!hasThesisHealth && play.factors.length <= 2}>
        <summary className="nh-deck-lab nh-deck-why-sum">
          Why this play was picked
          {play.factors.length > 0 && (
            <span className="nh-deck-why-n"> · {play.factors.length} factors</span>
          )}
        </summary>
        {play.factors.length === 0 && (
          <div className="nh-deck-recnote">Component breakdown not served for this lane yet — score {play.score}.</div>
        )}
        {topFactors.map((f) => (
          <div key={f.label} className={clsx("nh-deck-fac", f.points < 0 && "neg")}>
            <div>{f.label}{f.points > 0 && <Bar pts={f.points} />}</div>
            <div className="pts">{f.points > 0 ? "+" : ""}{f.points}</div>
          </div>
        ))}
        {moreFactors.length > 0 && (
          <details className="nh-deck-why-more">
            <summary className="nh-deck-recnote">Show {moreFactors.length} more factors</summary>
            {moreFactors.map((f) => (
              <div key={f.label} className={clsx("nh-deck-fac", f.points < 0 && "neg")}>
                <div>{f.label}{f.points > 0 && <Bar pts={f.points} />}</div>
                <div className="pts">{f.points > 0 ? "+" : ""}{f.points}</div>
              </div>
            ))}
          </details>
        )}
      </details>
      {play.thesis && (
        <div className="nh-deck-recnote" style={{ marginTop: 8, fontStyle: "italic" }}>{play.thesis}</div>
      )}
      {play.keySignal && (
        <div className="nh-deck-recnote" style={{ marginTop: 4 }}>Key signal: {play.keySignal}</div>
      )}
      <div className="nh-deck-meta">
        {play.regime && <div><span className="k">Regime</span><span className="v">{play.regime}</span></div>}
        {play.tierLabel && <div><span className="k">Conviction</span><span className="v">{play.tierLabel}</span></div>}
        {play.allocation && <div><span className="k">Allocation</span><span className="v">{play.allocation.role}</span></div>}
        <div><span className="k">Exit model</span><span className="v">{play.exitModel === "SCALE_OUT" ? "trim-scale" : play.exitModel.toLowerCase()}</span></div>
        {/* Entry range / target / stop are Legacy-only fields (terminalPlayFromEdition is the sole
            adapter that populates them). For Legacy plays the Management tab's LegacyManageGeometry
            renders these same three values PLUS live distance-to-level and an entry-zone track — the
            richer treatment — so showing the bare levels here too was a straight duplicate. Kept
            conditional (not deleted outright) in case a future non-Legacy horizon ever populates
            these fields without its own geometry panel. */}
        {play.horizon !== "LEGACY" && play.entryRange && <div><span className="k">Entry range</span><span className="v">{play.entryRange}</span></div>}
        {play.horizon !== "LEGACY" && play.targetLevel && <div><span className="k">Target</span><span className="v">{play.targetLevel}</span></div>}
        {play.horizon !== "LEGACY" && play.stopLevel && <div><span className="k">Stop</span><span className="v">{play.stopLevel}</span></div>}
        {/* R:R + Underlying + Premium-cap folded in here from the Management tab's
            ZeroDteEntryPlan/LegacyEntryPlan (Night Hawk panel declutter, docs/audit/FINDINGS.md
            2026-08-05): those components' Contract/Current-mark/Entry-premium/Cost-per-contract
            rows all duplicated the header/hero (0DTE: `play.contract` + OccCopy'd `play.occ` ==
            `optionsPlay`, "mark" already streams in the hero strip) or the PnL tab (Legacy:
            `LegacyPnlPanel` already shows Contract/Entry-premium/Stock-entry in its grid) — see
            the PR write-up for the exact duplicate mapping. R:R (both horizons), Underlying
            (0DTE only — Legacy's stock price already streams in the persistent header for
            non-premium rows), and Premium-cap (Legacy only) were the genuinely NEW data those
            components carried, so they move here instead of disappearing. */}
        {play.rrRatio != null && (
          <div>
            <span className="k">Risk : Reward</span>
            <span className={clsx("v", play.rrRatio >= 2 && "nh-deck-pos", play.rrRatio < 1 && "nh-deck-neg")}>
              {play.rrRatio.toFixed(1)}:1
            </span>
          </div>
        )}
        {play.horizon === "ZERO_DTE" && play.stockPrice != null && (
          <div><span className="k">Underlying</span><span className="v">${play.stockPrice.toFixed(2)}</span></div>
        )}
        {play.horizon === "LEGACY" && play.premiumCapOk != null && (
          <div>
            <span className="k">Premium cap</span>
            <span className={clsx("v", play.premiumCapOk ? "nh-deck-pos" : "nh-deck-neg")}>
              {play.premiumCapOk ? "✓ within cap" : "✗ above cap"}
            </span>
          </div>
        )}
      </div>
    </>
  );

  return (
    <>
      {play.horizon === "ZERO_DTE" && play.thesisFirst && (
        <div className="nh-deck-thesis-rank mb-3">
          <ThesisRankCard thesis={play.thesisFirst} />
        </div>
      )}
      {premium ? (
        <div className="nh-deck-premium-stack">
          <ThesisChecklistPanel play={play} />
          <ThesisExpectedMove play={play} />
        </div>
      ) : (
        // Non-premium (e.g. Legacy) plays never carry thesisHealth pillars, but may carry a
        // pinned tier-factor breakdown — ThesisChecklistPanel renders that section alone here
        // (was previously a separate "Conviction tier breakdown" block further down this panel).
        <ThesisChecklistPanel play={play} />
      )}
      {/* A dead branch (`hasThesisHealth` requires horizon===ZERO_DTE, which makes `premium`
          always true, so `!premium` here was always false) rendered `ThesisHealthPanel` — the
          THIRD surface of the same thesis-health number, never actually reachable in production.
          Removed along with its now-unused import (Night Hawk panel declutter,
          docs/audit/FINDINGS.md 2026-08-05); ThesisHealthPanel.tsx itself is left on disk
          untouched in case its richer per-pillar entry→now breakdown is wired up deliberately
          later, but it should never be reachable behind a `!premium` guard again. */}
      {hasThesisHealth ? (
        <details className="nh-deck-commit-snap" open={false}>
          <summary className="nh-deck-lab nh-deck-why-sum">Why we entered · commit snapshot (frozen)</summary>
          {commitSnapshot}
        </details>
      ) : (
        commitSnapshot
      )}
      <div
        className="nh-deck-break"
        style={broke ? undefined : { borderColor: unknown ? "rgba(255,255,255,.14)" : "rgba(53,255,158,.2)" }}
      >
        <div className="bh" style={broke ? undefined : { color: unknown ? "var(--dk-amber)" : "var(--dk-green)" }}>{monitorTitle}</div>
        <div className="nh-deck-feed">
          {broke ? (
            <div><span className="brk">✗ THESIS DEGRADING</span> — {play.thesisBreak!.note}. Recommend {liveRec}.</div>
          ) : unknown ? (
            <div><span className="warn">• thesis not monitored</span> — {play.thesisBreak?.note ?? "live tape read unavailable for this play"}.</div>
          ) : hasThesisHealth ? (
            <div>
              <span className={broke ? "brk" : "ok"}>
                {broke ? "✗" : "◉"} THESIS HEALTH {play.thesisHealth!.health}
              </span>
              {" — "}{monitorNote}
            </div>
          ) : (
            <div><span className="ok">✓ thesis intact</span> — {monitorNote}</div>
          )}
          {play.swingPromoted && (
            <button
              type="button"
              className="nh-deck-recnote nh-deck-swing-promoted-link"
              style={{ display: "block", marginTop: 6, textAlign: "left", background: "none", border: "none", padding: 0, cursor: "pointer", textDecoration: "underline", color: "var(--dk-green)" }}
              onClick={() => dispatchGotoSwing(play.ticker)}
              title="Jump to this ticker's row on the Swing board"
            >
              The play is still active and moved to Swings Open →
            </button>
          )}
        </div>
      </div>
    </>
  );
}

function ManagePanel({ play, nowMs }: { play: TerminalPlay; nowMs: number }) {
  const isCandidate = play.status === "WATCH" || play.status === "SKIP";
  // ZERO_DTE: recommendation/recNote already carry thesis overlay from the ~1s live deck pipeline.
  const mgmt = managementFor(play.exitModel, play.status, play.pnlPct ?? null);
  const badge =
    play.horizon === "ZERO_DTE" && play.recommendation
      ? play.recommendation
      : play.exitModel === "PLAN" && play.recommendation
        ? play.recommendation
        : mgmt.recommendation;
  const recNote =
    play.horizon === "ZERO_DTE" && play.recNote
      ? play.recNote
      : play.exitModel === "PLAN" && play.recNote
        ? play.recNote
        : mgmt.recNote;
  const premium = isZeroDtePremiumTerminal(play);
  // A CONDOR is a credit structure — its profit comes from decay/pin, NOT a rising long premium,
  // so it must never draw the directional trim ladder OR the −50/+100 ratchet track (both inverted).
  const isCondor = play.isCondor === true;
  const isTrimScale = showsTrimScaleLadder(play);
  // Lead with distance to stop/target when the frozen ladder carries absolute premiums.
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
  return (
    <>
      {isCandidate && (
        <div className="nh-deck-recnote nh-deck-premium-note">{recNote}</div>
      )}
      {premium && !isCondor && !isCandidate && (
        <div className="nh-deck-premium-stack">
          <ManagementActionCard play={play} recommendation={badge} progress={mgmt.progress} />
          <VisualTrimLadder play={play} />
        </div>
      )}
      {!premium && !isCandidate && (
        <>
          <div className="nh-deck-lab">Trade management — advisory (we recommend, you execute)</div>
          <div className="nh-deck-rec">
            <span className={clsx("nh-deck-recb", badge)}>{badge}</span>
            <span className="nh-deck-recnote">{recNote}</span>
          </div>
        </>
      )}
      {premium && recNote && (
        <div className="nh-deck-recnote nh-deck-premium-note">{recNote}</div>
      )}
      {distLine && play.horizon === "ZERO_DTE" && !isCondor && !isCandidate && (
        <div className="nh-deck-dist" title="Distance from live mark to the plan rails">
          <span className="k">Rails</span>
          <span className="v">{distLine}</span>
          {play.pnlPct != null && (
            <span className={clsx("pnl", play.pnlPct > 0 && "nh-deck-pos", play.pnlPct < 0 && "nh-deck-neg")}>
              {play.pnlPct >= 0 ? "+" : ""}{play.pnlPct.toFixed(1)}%
            </span>
          )}
        </div>
      )}

      {/* Time-stop clock is a 0DTE-ONLY discipline (flat by hard exit the SAME session). A Swing/
          LEAPS/Legacy position runs for days/weeks, so showing it a same-day countdown
          would be flatly false. Also suppressed once a 0DTE row is CLOSED (nothing left to time out). */}
      {showsTimeStopClock(play) && <TimeStopClock nowMs={nowMs} />}

      {isCondor && <CondorPanel play={play} />}

      {!isCondor && !isCandidate && play.exitModel === "RATCHET" && mgmt.progress != null && (
        <>
          <div className="nh-deck-track">
            <span className="lo">STOP −50%</span><span className="hi">TARGET +100%</span>
            <span className="mk" style={{ left: `${Math.round((mgmt.progress ?? 0) * 100)}%` }} />
          </div>
          <div className="nh-deck-recnote">Ratchet: fast 0DTE exit — stop trails up as it runs. Marker = distance stop→target.</div>
        </>
      )}

      {/* The REAL trim-scale ladder — each tranche with its trigger %, real premium level, and FIRED
          (banked) vs pending. Rendered only when the row's FROZEN policy is trim_scale (dormant under
          the prod ratchet default) AND it is not a condor. */}
      {isTrimScale && !premium && !isCandidate && <TrimScaleLadder play={play} />}

      {/* Legacy entry geometry — structured levels + live stock-price progress track. */}
      {play.horizon === "LEGACY" && (play.entryRange || play.targetLevel || play.stopLevel || play.progress != null) && (
        <LegacyManageGeometry play={play} />
      )}

      {/* Legacy SCALE_OUT fallback (horizon lanes carry no resolved policy): the pre-Terminal-v2
          derive-from-status tranche view, unchanged. */}
      {!isCondor && !isCandidate && play.exitModel === "SCALE_OUT" && !isTrimScale && (
        <>
          <div className="nh-deck-tranches">
            <div className={clsx("nh-deck-tr", (play.pnlPct ?? 0) >= 50 && "done")}><span className="p">⅓</span>@ +50%</div>
            <div className={clsx("nh-deck-tr", (play.pnlPct ?? 0) >= 100 ? "done" : "run")}><span className="p">⅓</span>@ +100%</div>
            <div className="nh-deck-tr"><span className="p">⅓</span>runner · trail</div>
          </div>
          <div className="nh-deck-recnote">Scale-out: bank partials at each tranche, trail the runner — the positive-skew exit.</div>
        </>
      )}
    </>
  );
}

/** The real trim-scale ladder from the frozen exit policy: profit tranches (banked/pending) + the
 *  runner's target/stop rails with live distance-to-each in $ and %. */
function TrimScaleLadder({ play }: { play: TerminalPlay }) {
  const p = play.exitPolicy!;
  const mark = play.mark;
  const distTo = (level: number | null): string => {
    if (level == null || mark == null) return "";
    const dollars = level - mark;
    const pct = mark > 0 ? (level / mark - 1) * 100 : null;
    return ` · ${dollars >= 0 ? "+" : ""}${dollars.toFixed(2)}${pct != null ? ` / ${pct >= 0 ? "+" : ""}${Math.round(pct)}%` : ""} away`;
  };
  return (
    <>
      <div className="nh-deck-lab" style={{ marginTop: 4 }}>Trim-scale ladder — the engine banks partials, then runs the rest</div>
      <div className="nh-deck-ladder">
        {p.trim_levels.map((t, i) => (
          <div key={i} className={clsx("nh-deck-rung", t.fired ? "fired" : "pending")}>
            <span className="frac">{fractionGlyph(t.fraction)}</span>
            <span className="trg">@ +{Math.round(t.trigger_pct)}%</span>
            <span className="lvl">{usd(t.premium)}</span>
            <span className="state">{t.fired ? "✓ BANKED" : "• pending"}</span>
          </div>
        ))}
        <div className="nh-deck-rung runner">
          <span className="frac">{fractionGlyph(p.runner_fraction)}</span>
          <span className="trg">RUNNER</span>
          <span className="lvl">
            <span className="tgt">tgt {usd(p.target_premium)}</span>
            <span className="stp">stop {usd(p.stop_premium)}</span>
          </span>
          <span className="state run">rides the rails</span>
        </div>
      </div>
      <div className="nh-deck-runner-rails">
        <div className="rail tgt">▲ target {usd(p.target_premium)}<span className="d">{distTo(p.target_premium)}</span></div>
        <div className="rail stp">▼ stop {usd(p.stop_premium)}<span className="d">{distTo(p.stop_premium)}</span></div>
        <div className="rail ts">◷ hard time-stop {p.time_stop_et} ET</div>
      </div>
      <div className="nh-deck-recnote">Trim-scale: bank ⅓ at each trim as the peak arms it (FIRED), run the last third to target/stop — the positive-skew exit the engine actually trades.</div>
    </>
  );
}

/** Re-shape a DeckCondor (camelCase render geometry) into the snake CondorGeometry condorTent() reads.
 *  One place so the panel + the left card build the tent from the same inputs. */
function tentGeomOf(c: DeckCondor) {
  return {
    spot: c.spot, short_put: c.shortPut, long_put: c.longPut, short_call: c.shortCall,
    long_call: c.longCall, wing_pts: c.wingPts, net_credit: c.netCredit, max_loss: c.maxLoss,
    breach_lower: c.breachLower, breach_upper: c.breachUpper,
    est_win_rate: c.winRate, est_intraday_breach_pct: c.breachRatePct,
  };
}

/** The REAL iron-condor render (Wave 2): the "price-inside-the-tent" gauge (spot vs the two short
 *  strikes), distance-to-breach both sides in points, the net credit captured, and WR shown TOGETHER
 *  with the intraday-breach rate (never a bare WR — the honest negative-skew pairing). Replaces the
 *  neutral Wave-1 placeholder. NEVER draws a directional long trim/ratchet ladder or a call/put P&L —
 *  a condor profits from decay/pin, not a rising premium. Degrades to an honest note when the geometry
 *  wasn't pinned on the row (never a fabricated tent). */
function CondorPanel({ play }: { play: TerminalPlay }) {
  const c = play.condor;
  if (!c) {
    return (
      <div className="nh-deck-recnote" style={{ marginTop: 4 }}>
        Credit iron condor — profit comes from the underlying pinning between the short strikes
        (premium decay), not a rising long premium. The 4-leg geometry wasn&apos;t pinned on this row,
        so the tent gauge is unavailable.
      </div>
    );
  }
  const tent = condorTent(tentGeomOf(c), c.spot);
  const pts = (n: number | null): string => (n == null ? "—" : n.toFixed(0));
  return (
    <div className="nh-deck-condor">
      <div className="nh-deck-lab" style={{ marginTop: 4 }}>
        Iron condor — sell the range · WIN if {c.spotIsLive ? "spot" : "close"} stays between the shorts
      </div>

      {/* Price-inside-the-tent gauge: the short-strike band with spot marked; the long wings frame it. */}
      <div className="nh-deck-tent">
        <div className="wing lo">▽ {c.longPut}</div>
        <div className={clsx("tent-band", tent.breached && "brk")}>
          <span className="edge lo">{c.breachLower}</span>
          <span className="edge hi">{c.breachUpper}</span>
          {tent.spotFrac != null ? (
            <span
              className={clsx("spot", tent.breached && "brk")}
              style={{ left: `${Math.round(tent.spotFrac * 100)}%` }}
            >
              <span className="dot" />
              <span className="lbl">{c.spot != null ? c.spot.toFixed(0) : "?"}{c.spotIsLive ? "" : " ∗"}</span>
            </span>
          ) : null}
        </div>
        <div className="wing hi">△ {c.longCall}</div>
      </div>
      {!c.spotIsLive && c.spot != null && (
        <div className="nh-deck-recnote">∗ commit-time spot — live underlying not on this refresh.</div>
      )}
      {tent.spotFrac == null && (
        <div className="nh-deck-recnote">Underlying price unavailable — showing the sold range only.</div>
      )}

      {/* Distance-to-breach, both sides, in underlying points. */}
      <div className="nh-deck-breach">
        <div className={clsx("side dn", (tent.roomDown ?? 1) <= 0 && "brk")}>
          <span className="k">↓ to put breach</span>
          <span className="v">{pts(tent.roomDown)} pt</span>
        </div>
        <div className={clsx("side up", (tent.roomUp ?? 1) <= 0 && "brk")}>
          <span className="k">↑ to call breach</span>
          <span className="v">{pts(tent.roomUp)} pt</span>
        </div>
      </div>

      {/* Net credit captured + defined max loss + the WR / breach-rate pair. */}
      <div className="nh-deck-meta" style={{ marginTop: 12 }}>
        <div><span className="k">Net credit</span><span className="v">{c.netCredit != null ? `$${c.netCredit.toFixed(0)}` : "—"}</span></div>
        <div><span className="k">Defined max loss</span><span className="v">{c.maxLoss != null ? `$${c.maxLoss.toFixed(0)}` : "—"}</span></div>
        <div><span className="k">Wings</span><span className="v">{c.wingPts.toFixed(0)} pt</span></div>
        <div><span className="k">Range</span><span className="v">{tent.widthPts.toFixed(0)} pt</span></div>
      </div>

      {c.breachRatePct != null && (
        <div className={clsx("nh-deck-wrline", tent.breached && "brk")}>
          <span className="br">Intraday breach rate · {c.breachRatePct.toFixed(0)}%</span>
        </div>
      )}
      <div className="nh-deck-recnote">
        Negative skew: a small credit on most days, a DEFINED loss on a breakout. High WR is not edge on
        its own — the credit, the breach stop, and small size are. {tent.breached ? "Range BREACHED — the defended pin failed; the loss is capped at the wing." : "Range holding — decay is working for you."}
      </div>
    </div>
  );
}

/** Countdown to the hard time-stop + a session-decay bar (09:30→exit elapsed). */
function TimeStopClock({ nowMs }: { nowMs: number }) {
  const exitLabel = zerodteTimeStopEtLabel();
  // Recompute ET minute-of-day each tick (etNowParts reads the live clock).
  void nowMs; // depend on the tick so this recomputes every second
  const { hour, minute } = etNowParts();
  const clock = timeStopClock(hour * 60 + minute);
  return (
    <div className={clsx("nh-deck-clock", clock.past_time_stop && "past")}>
      <div className="row">
        <span className="lab">◷ THETA / TIME-STOP</span>
        <span className={clsx("val", clock.minutes_remaining <= 30 && "warn")}>
          {clock.past_time_stop ? `TIME STOP — flat by ${exitLabel}` : `${clock.label} to ${exitLabel} ET`}
        </span>
      </div>
      <div className="decay"><i style={{ width: `${Math.round(clock.elapsed_frac * 100)}%` }} /></div>
    </div>
  );
}

function PnlPanel({ play }: { play: TerminalPlay }) {
  const markFlash = useFlash(play.mark ?? play.pnlPct ?? null);
  if (play.horizon === "LEGACY") return <LegacyPnlPanel play={play} />;
  const premium = isZeroDtePremiumTerminal(play);
  const has = play.entry != null;
  const live = play.pnlPct;
  const exec = play.execPnlPct;
  return (
    <>
      {premium && has && (
        <>
          <TradeOutcomePanel play={play} />
          <TradeExcursionGraphic play={play} markFlash={markFlash} />
        </>
      )}
      {!premium && (
        <>
          <div className="nh-deck-lab">Live P&amp;L</div>
          <div className={clsx("nh-deck-pnlbig", (live ?? 0) > 0 && "nh-deck-pos", (live ?? 0) < 0 && "nh-deck-neg")}>
            {has && live != null ? `${live > 0 ? "+" : ""}${live.toFixed(1)}%` : "— not entered"}
          </div>
        </>
      )}
      {exec != null && (
        <div className="nh-deck-execline">
          mid <b>{live != null ? `${live > 0 ? "+" : ""}${live.toFixed(1)}%` : "—"}</b>
          {" · "}fill ≈<b className={clsx(exec < 0 && "nh-deck-neg")}>{`${exec > 0 ? "+" : ""}${exec.toFixed(1)}%`}</b>
          {play.execMark != null && <span className="nh-deck-recnote"> (sell into {usd(play.execMark)} bid)</span>}
        </div>
      )}
      {!has && play.mark != null && (
        <ZeroDtePreEntryContext play={play} />
      )}
      {has && !premium && <TradeExcursionGraphic play={play} markFlash={markFlash} />}
      <div className="nh-deck-grid">
        <div><span className="k">Entry</span><span className="v">{has ? usd(play.entry) : "—"}</span></div>
        <div><span className="k">Live mark</span><span className="v">{usd(play.mark)}</span></div>
        {/* Peak/trough already shown once in the hero (0DTE/Swing) and again in the excursion-graphic
            stats row above — a 3rd rendering here was redundant for premium plays. Kept for
            non-premium (LEAPS/Legacy) rows, which carry neither the hero nor this excursion stats
            row, so this grid is their only Peak/Trough surface. */}
        {has && !premium && <div><span className="k">Peak</span><span className="v nh-deck-pos">{signPct(play.peak)}</span></div>}
        {has && !premium && <div><span className="k">Trough</span><span className="v nh-deck-neg">{signPct(play.trough)}</span></div>}
      </div>
      {has && !premium && <div className="nh-deck-recnote" style={{ marginTop: 16 }}>Peak/trough = the full excursion since entry — how much heat you took and gave back.</div>}
    </>
  );
}

/** Pre-entry context for 0DTE plays: shows live mark relative to the plan's stop/target levels. */
function ZeroDtePreEntryContext({ play }: { play: TerminalPlay }) {
  const rr = play.rrRatio;
  return (
    <div className="nh-deck-meta" style={{ marginTop: 8 }}>
      <div className="nh-deck-recnote" style={{ marginBottom: 8, opacity: 0.7 }}>
        Not yet committed — mark vs plan levels:
      </div>
      {play.optionsPlay && (
        <div><span className="k">Contract</span><span className="v" style={{ fontSize: "0.85em" }}>{play.optionsPlay}</span></div>
      )}
      {rr != null && (
        <div>
          <span className="k">Risk : Reward</span>
          <span className={clsx("v", rr >= 2 && "nh-deck-pos", rr < 1 && "nh-deck-neg")}>
            {rr.toFixed(1)}:1{rr >= 2 ? " (strong)" : rr >= 1 ? " (favorable)" : rr >= 0.5 ? " (acceptable)" : " (tight)"}
          </span>
        </div>
      )}
    </div>
  );
}

// NOTE: `LegacyEntryPlan` and `ZeroDteEntryPlan` (the Management tab's Contract/Current-mark/
// Underlying/Entry-premium/Cost-per-contract/Premium-cap/R:R trio) were removed here (Night Hawk
// panel declutter, docs/audit/FINDINGS.md 2026-08-05). Verified duplicate mapping per field:
//  - Contract (`optionsPlay`) — for 0DTE this is LITERALLY `play.occ` (adapters.ts sets
//    `optionsPlay: occ` verbatim), already shown via the `OccCopy` control in the hero stream
//    strip; for Legacy it duplicated `LegacyPnlPanel`'s own "Contract" row (PnL tab, same field).
//  - Current mark (0DTE) — already streams live in the hero's compact stream strip above the tabs.
//  - Entry premium / Cost-per-contract (Legacy) — duplicated `LegacyPnlPanel`'s "Stock entry" /
//    "Entry premium" rows (PnL tab) — same fields (`play.entry` / `play.entryCostPerContract`),
//    just relabeled inconsistently between the two renders (worth noting: this Management copy
//    mislabeled `play.entry` — the STOCK entry price — as "Entry premium", which the PnL tab
//    correctly reserves for `entryCostPerContract`; removing this row also removes that mislabel).
// R:R (both horizons), Underlying (0DTE only — Legacy's stock price already streams in the
// persistent non-premium header), and Premium-cap (Legacy only) were the genuinely NEW fields
// these components carried — they now live in the Thesis tab's meta grid (`ThesisPanel`'s
// `commitSnapshot`, always reachable regardless of committed status) instead of disappearing.
// `usd()` above stays in use elsewhere in this file (PnL/rails formatting).

function LegacyManageGeometry({ play }: { play: TerminalPlay }) {
  const target = play.targetLevel ? parseFloat(play.targetLevel.replace(/[^0-9.]/g, "")) : null;
  const stop = play.stopLevel ? parseFloat(play.stopLevel.replace(/[^0-9.]/g, "")) : null;
  const spot = play.stockPrice;

  const distTarget = spot != null && target != null && Number.isFinite(target) && spot > 0
    ? { pct: ((target - spot) / spot * 100), dollars: target - spot } : null;
  const distStop = spot != null && stop != null && Number.isFinite(stop) && spot > 0
    ? { pct: ((stop - spot) / spot * 100), dollars: stop - spot } : null;

  // Entry zone marker on the progress track (the zone between stop and target where
  // entry is recommended). Requires knowing stop, target, and the entry range midpoint.
  const entryNums = play.entryRange?.match(/[\d.]+/g)?.map(Number).filter(Number.isFinite) ?? [];
  const entryMid = entryNums.length >= 2 ? (entryNums[0]! + entryNums[entryNums.length - 1]!) / 2
    : entryNums.length === 1 ? entryNums[0]! : null;
  const entryFrac = (stop != null && target != null && target !== stop && entryMid != null)
    ? Math.max(0, Math.min(1, (entryMid - stop) / (target - stop)))
    : null;

  // Position zone label for the recNote
  const zoneLabel = (play.progress != null && spot != null)
    ? play.progress <= 0 ? "below stop — cut the position"
    : play.progress >= 1 ? "at/above target — take profit"
    : play.progress < 0.3 ? "near stop — elevated risk"
    : play.progress > 0.7 ? "nearing target — watch for exit"
    : "mid-range — hold per plan"
    : null;

  return (
    <>
      {(play.entryRange || play.targetLevel || play.stopLevel) && (
        <div className="nh-deck-grid" style={{ marginBottom: 8 }}>
          {play.stopLevel && (
            <div>
              <span className="k">Stop</span>
              <span className="v nh-deck-neg">
                {play.stopLevel}
                {distStop && <span className="nh-deck-dist"> ({distStop.dollars >= 0 ? "+" : ""}{distStop.dollars.toFixed(2)} / {distStop.pct >= 0 ? "+" : ""}{distStop.pct.toFixed(1)}%)</span>}
              </span>
            </div>
          )}
          {play.entryRange && <div><span className="k">Entry zone</span><span className="v">{play.entryRange}</span></div>}
          {play.targetLevel && (
            <div>
              <span className="k">Target</span>
              <span className="v nh-deck-pos">
                {play.targetLevel}
                {distTarget && <span className="nh-deck-dist"> ({distTarget.dollars >= 0 ? "+" : ""}{distTarget.dollars.toFixed(2)} / {distTarget.pct >= 0 ? "+" : ""}{distTarget.pct.toFixed(1)}%)</span>}
              </span>
            </div>
          )}
        </div>
      )}
      {play.progress != null && (
        <>
          <div className="nh-deck-track">
            <span className="lo">STOP</span><span className="hi">TARGET</span>
            {entryFrac != null && (
              <span className="nh-deck-entry-zone" style={{ left: `${Math.round(entryFrac * 100)}%` }} title="Entry zone midpoint" />
            )}
            <span className="mk" style={{ left: `${Math.round(play.progress * 100)}%` }} />
          </div>
          <div className="nh-deck-recnote">
            {spot != null ? `${play.ticker} $${spot.toFixed(2)} — ` : ""}
            {zoneLabel ?? "stock position vs your stop and target levels."}
          </div>
        </>
      )}
    </>
  );
}

function LegacyPnlPanel({ play }: { play: TerminalPlay }) {
  const markFlash = useFlash(play.pnlPct ?? null);
  const hasStock = play.stockPrice != null;
  const chg = play.stockChangePct;
  const pnl = play.pnlPct;
  const spot = play.stockPrice;
  return (
    <>
      <div className="nh-deck-lab">Stock position</div>
      <div className={clsx("nh-deck-pnlbig", (pnl ?? chg ?? 0) > 0 && "nh-deck-pos", (pnl ?? chg ?? 0) < 0 && "nh-deck-neg")}>
        {hasStock ? `$${spot!.toFixed(2)}` : "— awaiting quote"}
      </div>
      {pnl != null && (
        <div className="nh-deck-execline">
          stock P&amp;L from entry <b className={clsx(pnl < 0 && "nh-deck-neg", pnl > 0 && "nh-deck-pos")}>{pnl >= 0 ? "+" : ""}{pnl.toFixed(1)}%</b>
        </div>
      )}
      {hasStock && chg != null && (
        <div className="nh-deck-execline">
          day change <b className={clsx(chg < 0 && "nh-deck-neg", chg > 0 && "nh-deck-pos")}>{chg >= 0 ? "+" : ""}{chg.toFixed(1)}%</b>
        </div>
      )}
      <div className="nh-deck-grid" style={{ marginTop: 12 }}>
        <div><span className="k">Stock</span><span className="v">{hasStock ? `$${spot!.toFixed(2)}` : "—"}</span></div>
        <div><span className="k">Stock entry</span><span className="v">{play.entry != null ? `$${play.entry.toFixed(2)}` : play.entryRange ?? "—"}</span></div>
        <div><span className="k">Entry premium</span><span className="v">{play.entryCostPerContract != null ? usd(play.entryCostPerContract) : "—"}</span></div>
        {/* Target/Stop levels + live distance, and the STOP↔TARGET progress track below, are rendered
            ONCE — in the Management tab's LegacyManageGeometry, which additionally draws the
            entry-zone marker and a plain-language zone label. Repeating the bare distance grid and a
            second (marker-less) track here was pure duplication of the same play.targetLevel /
            play.stopLevel / play.progress values — see docs/audit/FINDINGS.md 2026-08-05. */}
        {play.ivRank != null && (
          <div>
            <span className="k">IV rank</span>
            <span className="v">{Math.round(play.ivRank)}</span>
          </div>
        )}
        {play.rrRatio != null && (
          <div>
            <span className="k">R:R</span>
            <span className={clsx("v", play.rrRatio >= 2 && "nh-deck-pos", play.rrRatio < 1 && "nh-deck-neg")}>
              {play.rrRatio.toFixed(1)}:1
            </span>
          </div>
        )}
        {play.optionsPlay && <div><span className="k">Contract</span><span className="v">{play.optionsPlay}</span></div>}
      </div>
      {(play.peak != null || play.trough != null) && (
        <TradeExcursionGraphic play={play} markFlash={markFlash} />
      )}
      <div className="nh-deck-recnote" style={{ marginTop: 16 }}>
        {pnl != null
          ? "Stock-level P&L from entry mid — tracks your thesis direction. Option premium P&L requires a live option quote subscription."
          : "Awaiting live stock quote to compute P&L from entry."}
      </div>
    </>
  );
}
