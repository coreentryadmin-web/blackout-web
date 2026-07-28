"use client";

import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import type { TerminalPlay } from "./types";
import { timeStopClock } from "@/lib/zerodte/terminal-ladder";
import { isZeroDteMarkStale, ZERODTE_MARK_STALE_MS } from "@/lib/zerodte/marks-math";
import { condorTent, condorWinRateLine } from "@/lib/zerodte/condor-render";
import { etNowParts } from "@/features/nighthawk/lib/session";
import { showsRatchetTrack, showsTimeStopClock, showsTrimScaleLadder } from "./terminal-guards";
import { excursionBar, formatWinRateCi, signColorClass } from "@/lib/zerodte/terminal-edge";
import type { DeckCondor } from "./types";

type Tab = "thesis" | "manage" | "pnl";

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

/** ET wall-clock (HH:MM) of an ISO instant, for the why-now ribbon. Formats in America/New_York
 *  regardless of the instant's stored offset (a DB row may be UTC). Null/unparseable → null. */
function etClock(iso: string | null | undefined): string | null {
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

/** Flash a cell green/red when its value changes between renders (honest live-change feedback). */
function useFlash(value: unknown) {
  const prev = useRef(value);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (prev.current !== value) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 250);
      prev.current = value;
      return () => clearTimeout(t);
    }
  }, [value]);
  return flash;
}

/** A 1s local clock so the time-stop countdown, session-decay bar, and mark-age readout advance
 *  every second even between the board poll (5s) and the SSE mark push (1s) — the "always live"
 *  requirement. Cheap: one interval for the whole terminal, cleared on unmount. */
function useSecondTick(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

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

export function PlayTerminal({ play }: { play: TerminalPlay | null }) {
  const [tab, setTab] = useState<Tab>("thesis");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "1") setTab("thesis");
      else if (e.key === "2") setTab("manage");
      else if (e.key === "3") setTab("pnl");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // Hooks must run unconditionally (before any early return).
  const markFlash = useFlash(play?.mark ?? null);
  const nowMs = useSecondTick();

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
  const stale = hasAsOf ? isZeroDteMarkStale(asOfMs, nowMs, ZERODTE_MARK_STALE_MS) : false;
  const sync = play.markIsSync === true || (!hasAsOf && play.mark != null);
  const live = play.mark != null && hasAsOf && !stale;
  const ageLabel =
    ageMs == null ? null : ageMs < 1000 ? "now" : ageMs < 60_000 ? `${Math.round(ageMs / 1000)}s ago` : `${Math.round(ageMs / 60_000)}m ago`;

  return (
    <div className={clsx("nh-deck-right", stale && "nh-deck-dim")}>
      <div className="nh-deck-th">
        <span className="tk">{play.ticker} · {play.direction}</span>
        <span className="ct">{play.contract}<OccCopy occ={play.occ} /></span>
        <span className="nh-deck-cursor" aria-hidden />
        <span className="big"><div className="nh-deck-score">{play.score}</div><div className="lab">SCORE</div></span>
      </div>

      <HeaderBadges play={play} />

      <div className="nh-deck-stream">
        {live ? (
          <><span className="nh-deck-dot" /><span className="lv">LIVE</span></>
        ) : sync ? (
          <><span className="nh-deck-dot sync" /><span className="sy">SYNC</span></>
        ) : (
          <><span className="nh-deck-dot off" /><span className="of">{stale ? "STALE" : "—"}</span></>
        )}
        {" · mark "}
        <span className={clsx(markFlash && "neon", stale && "nh-deck-stale-mark")}>{usd(play.mark)}</span>
        {/* Executable fill — a long exits into the BID. Mid alone flatters the exit; show both.
            Suppressed for a condor (credit structure — the bid-fill framing is directional/inverted). */}
        {!isCondor && play.execMark != null && <span className="nh-deck-fill"> · fill ≈{usd(play.execMark)}</span>}
        {ageLabel && <span className="nh-deck-age"> · {sync ? "sync" : ageLabel}</span>}
        {stale && <span className="nh-deck-stalebadge">stale &gt;{Math.round(ZERODTE_MARK_STALE_MS / 1000)}s</span>}
      </div>

      <div className="nh-deck-greeks">
        <GreekCell k="delta" v={g?.delta ?? null} />
        <GreekCell k="gamma" v={g?.gamma ?? null} />
        <GreekCell k="theta" v={g?.theta ?? null} />
        <GreekCell k="vega" v={g?.vega ?? null} />
        <GreekCell k="iv" v={g?.iv ?? null} />
      </div>

      <div className="nh-deck-tabs">
        <button className={clsx(tab === "thesis" && "on")} onClick={() => setTab("thesis")}><span className="n">[1]</span>Thesis</button>
        <button className={clsx(tab === "manage" && "on")} onClick={() => setTab("manage")}><span className="n">[2]</span>Management</button>
        <button className={clsx(tab === "pnl" && "on")} onClick={() => setTab("pnl")}><span className="n">[3]</span>PnL</button>
      </div>

      <div className="nh-deck-body">
        {tab === "thesis" && <ThesisPanel play={play} />}
        {tab === "manage" && <ManagePanel play={play} nowMs={nowMs} />}
        {tab === "pnl" && <PnlPanel play={play} />}
      </div>

      <div className="nh-deck-foot">
        <span>EXIT · {play.exitModel === "SCALE_OUT" ? "TRIM-SCALE" : play.exitModel}</span>
        <span>{play.tierLabel ? `TIER ${play.tierLabel}` : play.scorecard ? `WR ${play.scorecard.winRate}%` : ""}</span>
        {play.allocation && <span style={{ marginLeft: "auto" }}>{play.allocation.role} · {play.allocation.sizing}</span>}
      </div>
    </div>
  );
}

/** Tier · confluence · discovery-origin header badges + the calibration scorecard line (shown ONLY
 *  when the payload carries a real figure — never fabricated). Renders nothing when a play carries
 *  none of them (a legacy row), so the header stays clean. */
function HeaderBadges({ play }: { play: TerminalPlay }) {
  const hasBadges = play.tierLabel || play.confluence != null || (play.discoveryOrigin?.length ?? 0) > 0;
  if (!hasBadges && !play.scorecard) return null;
  return (
    <div className="nh-deck-badges">
      {play.tierLabel && <span className="nh-deck-badge tier">TIER {play.tierLabel}</span>}
      {play.confluence != null && <span className="nh-deck-badge conf">CONFLUENCE {play.confluence}/2</span>}
      {play.discoveryOrigin?.map((o) => (
        <span key={o} className="nh-deck-badge orig">{o}</span>
      ))}
      {play.scorecard && (
        // Win-rate is NEVER shown bare: formatWinRateCi pairs it with the Wilson 95% CI when the
        // payload carries one (WS-07/WS-09), else an explicit "CI n/a" — never a fabricated interval.
        <span className="nh-deck-badge sc" title="Calibrated strategy record (Wilson 95% CI)">
          {formatWinRateCi(play.scorecard)} · {signPct(play.scorecard.avg)} avg
        </span>
      )}
    </div>
  );
}

function ThesisPanel({ play }: { play: TerminalPlay }) {
  const level = play.thesisBreak?.level ?? "intact";
  const broke = level === "warn" || level === "break";
  const unknown = level === "unknown";
  // "Why now" ribbon — the event-driven trigger that surfaced this play, with the ET flag time
  // when the row carries one. Omitted entirely when no reason was pinned (honest absence).
  const whyAt = etClock(play.firstFlaggedAt);
  return (
    <>
      {play.whyNow && (
        <div className="nh-deck-whynow" title="The event-driven scan trigger that surfaced this play">
          <span className="ic" aria-hidden>⚡</span>
          <span className="lb">triggered by:</span>
          <span className="rs">{play.whyNow.label}</span>
          {whyAt && <span className="at"> · {whyAt} ET</span>}
        </div>
      )}
      <div className="nh-deck-lab">Why this play was picked</div>
      {play.factors.length === 0 && <div className="nh-deck-recnote">Component breakdown not served for this lane yet — score {play.score}. {play.recNote}</div>}
      {play.factors.map((f) => (
        <div key={f.label} className={clsx("nh-deck-fac", f.points < 0 && "neg")}>
          <div>{f.label}{f.points > 0 && <Bar pts={f.points} />}</div>
          <div className="pts">{f.points > 0 ? "+" : ""}{f.points}</div>
        </div>
      ))}
      {play.gates.length > 0 && (
        <>
          <div className="nh-deck-lab" style={{ marginTop: 16 }}>Hard gates</div>
          <div className="nh-deck-gaterow">
            {play.gates.map((g) => (
              <span key={g.label} className={clsx("nh-deck-gate", g.ok ? "ok" : "no")}>{g.ok ? "✓" : "✗"} {g.label}</span>
            ))}
          </div>
        </>
      )}
      <div className="nh-deck-meta">
        {play.regime && <div><span className="k">Regime</span><span className="v">{play.regime}</span></div>}
        {play.tierLabel && <div><span className="k">Conviction</span><span className="v">{play.tierLabel}</span></div>}
        {play.allocation && <div><span className="k">Allocation</span><span className="v">{play.allocation.role}</span></div>}
        <div><span className="k">Exit model</span><span className="v">{play.exitModel === "SCALE_OUT" ? "trim-scale" : play.exitModel.toLowerCase()}</span></div>
      </div>
      <div
        className="nh-deck-break"
        style={broke ? undefined : { borderColor: unknown ? "rgba(255,255,255,.14)" : "rgba(53,255,158,.2)" }}
      >
        <div className="bh" style={broke ? undefined : { color: unknown ? "var(--dk-amber)" : "var(--dk-green)" }}>◉ LIVE THESIS MONITOR</div>
        <div className="nh-deck-feed">
          {broke ? (
            <div><span className="brk">✗ THESIS DEGRADING</span> — {play.thesisBreak!.note}. Recommend {play.recommendation}.</div>
          ) : unknown ? (
            // Data-absent (e.g. a working position with no fresh tape read) — neutral, NOT a false green
            // and NOT a false "degrading". Honest: we're not monitoring the thesis for this play right now.
            <div><span className="warn">• thesis not monitored</span> — {play.thesisBreak?.note ?? "live tape read unavailable for this play"}.</div>
          ) : (
            <div><span className="ok">✓ thesis intact</span> — evidence holding; monitor updates on each marks push.</div>
          )}
        </div>
      </div>
    </>
  );
}

function ManagePanel({ play, nowMs }: { play: TerminalPlay; nowMs: number }) {
  const badge = play.recommendation;
  // A CONDOR is a credit structure — its profit comes from decay/pin, NOT a rising long premium,
  // so it must never draw the directional trim ladder OR the −50/+100 ratchet track (both inverted).
  const isCondor = play.isCondor === true;
  const isTrimScale = showsTrimScaleLadder(play);
  return (
    <>
      <div className="nh-deck-lab">Trade management — advisory (we recommend, you execute)</div>
      <div className="nh-deck-rec">
        <span className={clsx("nh-deck-recb", badge)}>{badge}</span>
        {/* Plain text only — never inject HTML (recNote is authored plain; React escapes it safely). */}
        <span className="nh-deck-recnote">{play.recNote}</span>
      </div>

      {/* Time-stop clock is a 0DTE-ONLY discipline (flat by 15:30 ET the SAME session). A Swing/
          LEAPS/Legacy position runs for days/weeks, so showing it a "flat by 15:30 today" countdown
          would be flatly false. Also suppressed once a 0DTE row is CLOSED (nothing left to time out). */}
      {showsTimeStopClock(play) && <TimeStopClock nowMs={nowMs} />}

      {isCondor && <CondorPanel play={play} />}

      {showsRatchetTrack(play) && (
        <>
          <div className="nh-deck-track">
            <span className="lo">STOP −50%</span><span className="hi">TARGET +100%</span>
            <span className="mk" style={{ left: `${Math.round((play.progress ?? 0) * 100)}%` }} />
          </div>
          <div className="nh-deck-recnote">Ratchet: fast 0DTE exit — stop trails up as it runs. Marker = distance stop→target.</div>
        </>
      )}

      {/* The REAL trim-scale ladder — each tranche with its trigger %, real premium level, and FIRED
          (banked) vs pending. Rendered only when the row's FROZEN policy is trim_scale (dormant under
          the prod ratchet default) AND it is not a condor. */}
      {isTrimScale && <TrimScaleLadder play={play} />}

      {/* Legacy stock-price progress track — rendered when the stock quote overlay computes progress
          from the edition's target/stop levels. Shows where the underlying sits between stop and target. */}
      {play.horizon === "LEGACY" && play.progress != null && (
        <>
          <div className="nh-deck-track">
            <span className="lo">STOP</span><span className="hi">TARGET</span>
            <span className="mk" style={{ left: `${Math.round(play.progress * 100)}%` }} />
          </div>
          <div className="nh-deck-recnote">Stock position: live underlying vs your stop and target levels.</div>
        </>
      )}

      {/* Legacy SCALE_OUT fallback (horizon lanes carry no resolved policy): the pre-Terminal-v2
          derive-from-status tranche view, unchanged. */}
      {!isCondor && play.exitModel === "SCALE_OUT" && !isTrimScale && (
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
  const wr = condorWinRateLine({ est_win_rate: c.winRate, est_intraday_breach_pct: c.breachRatePct });
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

      {/* WR is ALWAYS shown with the breach-rate companion — never a bare, flattering win-rate. */}
      <div className={clsx("nh-deck-wrline", tent.breached && "brk")}>
        {wr.winRate != null ? (
          <>
            <span className="wr">{Math.round(wr.winRate)}% close-settle WR</span>
            {wr.breachRatePct != null ? (
              <span className="br"> · {wr.breachRatePct.toFixed(0)}% intraday breach rate</span>
            ) : (
              <span className="br dim"> · intraday breach rate not measured for this geometry</span>
            )}
          </>
        ) : (
          <span className="dim">Calibrated WR not attached to this row.</span>
        )}
      </div>
      <div className="nh-deck-recnote">
        Negative skew: a small credit on most days, a DEFINED loss on a breakout. High WR is not edge on
        its own — the credit, the breach stop, and small size are. {tent.breached ? "Range BREACHED — the defended pin failed; the loss is capped at the wing." : "Range holding — decay is working for you."}
      </div>
    </div>
  );
}

/** Countdown to the 15:30 ET hard time-stop + a session-decay bar (09:30→15:30 elapsed). */
function TimeStopClock({ nowMs }: { nowMs: number }) {
  // Recompute ET minute-of-day each tick (etNowParts reads the live clock).
  void nowMs; // depend on the tick so this recomputes every second
  const { hour, minute } = etNowParts();
  const clock = timeStopClock(hour * 60 + minute);
  return (
    <div className={clsx("nh-deck-clock", clock.past_time_stop && "past")}>
      <div className="row">
        <span className="lab">◷ THETA / TIME-STOP</span>
        <span className={clsx("val", clock.minutes_remaining <= 30 && "warn")}>
          {clock.past_time_stop ? "TIME STOP — flat by 15:30" : `${clock.label} to 15:30 ET`}
        </span>
      </div>
      <div className="decay"><i style={{ width: `${Math.round(clock.elapsed_frac * 100)}%` }} /></div>
    </div>
  );
}

function PnlPanel({ play }: { play: TerminalPlay }) {
  const has = play.entry != null;
  const live = play.pnlPct;
  const exec = play.execPnlPct;
  return (
    <>
      <div className="nh-deck-lab">Live P&amp;L</div>
      <div className={clsx("nh-deck-pnlbig", (live ?? 0) > 0 && "nh-deck-pos", (live ?? 0) < 0 && "nh-deck-neg")}>
        {has && live != null ? `${live > 0 ? "+" : ""}${live}%` : "— not entered"}
      </div>
      {/* Executable P&L — what a member could actually realize selling into the BID right now,
          beside the mid. Only shown when a live two-sided book priced it (no fabricated fill). */}
      {exec != null && (
        <div className="nh-deck-execline">
          mid <b>{live != null ? `${live > 0 ? "+" : ""}${live}%` : "—"}</b>
          {" · "}fill ≈<b className={clsx(exec < 0 && "nh-deck-neg")}>{`${exec > 0 ? "+" : ""}${exec}%`}</b>
          {play.execMark != null && <span className="nh-deck-recnote"> (sell into {usd(play.execMark)} bid)</span>}
        </div>
      )}
      <ExcursionViz play={play} />
      <div className="nh-deck-grid">
        <div><span className="k">Entry</span><span className="v">{has ? usd(play.entry) : "—"}</span></div>
        <div><span className="k">Live mark</span><span className="v">{usd(play.mark)}</span></div>
        <div><span className="k">Peak</span><span className="v nh-deck-pos">{signPct(play.peak)}</span></div>
        <div><span className="k">Trough</span><span className="v nh-deck-neg">{signPct(play.trough)}</span></div>
      </div>
      <div className="nh-deck-recnote" style={{ marginTop: 16 }}>Peak/trough = the full excursion since entry — how much heat you took and gave back.</div>
    </>
  );
}

/** EXCURSION (MAE/MFE) mini-viz — the heat RANGE since entry: MFE (best) at one end, MAE (worst)
 *  at the other, and the current mark placed between them. Structure-aware WITHOUT re-inverting:
 *  the adapter already seller-frames a condor's peak/trough/pnl, so best/worst/current arrive in
 *  one consistent %-space here. Honest labeling: this is the excursion RANGE, not a per-tick path
 *  (the payload carries only the latched extremes — no tick history — so no sparkline is drawn).
 *  Omitted when the extremes aren't on the row (nothing to draw). */
function ExcursionViz({ play }: { play: TerminalPlay }) {
  const bar = excursionBar(play.peak, play.trough, play.pnlPct);
  const flash = useFlash(play.pnlPct ?? null);
  if (!bar) return null;
  const fmt = (n: number): string => `${n > 0 ? "+" : ""}${Math.round(n)}%`;
  const pos = bar.currentFrac == null ? null : Math.round(bar.currentFrac * 100);
  return (
    <div className="nh-deck-exc">
      <div className="nh-deck-lab" style={{ marginTop: 14 }}>Excursion range — heat taken since entry (MAE ↔ MFE)</div>
      <div className="nh-deck-excbar">
        {/* Caps are colored BY SIGN (signColorClass), not by which end they sit on — an all-green
            run shows its MAE cap green, an all-red run its MFE cap red. Honest number AND color. */}
        <span className={clsx("cap lo", signColorClass(bar.worst))}>{fmt(bar.worst)}</span>
        <span className={clsx("cap hi", signColorClass(bar.best))}>{fmt(bar.best)}</span>
        {pos != null && (
          <span className={clsx("mk", flash && "neon")} style={{ left: `${pos}%` }}>
            <span className="dot" />
            <span className="lbl">{play.pnlPct != null ? fmt(play.pnlPct) : "—"}</span>
          </span>
        )}
      </div>
      <div className="nh-deck-exclabels">
        <span className={clsx("mae", signColorClass(bar.worst))}>MAE {fmt(bar.worst)}</span>
        <span className={clsx("mfe", signColorClass(bar.best))}>MFE {fmt(bar.best)}</span>
      </div>
      <div className="nh-deck-recnote">
        {pos == null
          ? "Best/worst excursion since entry — current mark not priced right now."
          : "Marker = where the mark sits now between its worst (MAE) and best (MFE) since entry. Range, not a tick-by-tick path."}
      </div>
    </div>
  );
}
