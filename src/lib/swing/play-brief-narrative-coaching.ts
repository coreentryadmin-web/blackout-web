/**
 * Extended trade-manager coaching bullets — folds intel-section data into Largo narrative.
 * Pure + deterministic. Consumed by play-brief-narrative.ts.
 */
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import { optionMarkIsStale, playExpectsLiveOptionMark } from "./play-brief-absence";
import type { SwingPlayBriefContext } from "./play-brief-types";
import type { VectorFullState } from "@/lib/bie/vector-full-state";
import { computeLaneRank } from "./play-brief-lane-rank";
import { fmtPremium } from "@/lib/fmt-money";
import { meridianPeerEarningsCoaching } from "./play-brief-meridian-peer-core";
import { trustedHelixFlow } from "./play-brief-absence";
import { mfeCaptureOutcome } from "./mfe-capture";
import { thesisHealthUncalibrated } from "./thesis-health";
import { technicalsBias } from "./play-brief-technicals";

function fin(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function fmtUsd(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}$${n.toFixed(2)}`;
}

function fmtPct(n: number, digits = 1): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

function vectorOf(ctx: SwingPlayBriefContext): VectorFullState | null {
  return ctx.vector ?? ctx.ecosystem?.vector_full_state ?? null;
}

/** Urgent thesis invalidation — leads narrative when fired. */
export function thesisBreakCoaching(play: TerminalPlay): string | null {
  if (thesisHealthUncalibrated(play.thesisHealth)) return null;
  const level = play.thesisBreak?.level ?? play.thesisHealth?.thesisBreakLevel;
  const note = play.thesisBreak?.note ?? play.thesisHealth?.thesisBreakNote;
  if (!level || level === "unknown" || level === "intact") return null;

  if (level === "break") {
    return `**Thesis BREAK** — ${note ?? "structural invalidation fired"}. Exit or cut to runner only; don't add size.`;
  }
  return `**Thesis WARN** — ${note ?? "pillars fading"}. Tighten stops; next trim rail is your friend.`;
}

/** Weakest / fading pillar — explains the health % number. */
export function thesisPillarCoaching(play: TerminalPlay): string | null {
  const h = play.thesisHealth;
  if (!h?.pillars?.length) return null;
  if (thesisHealthUncalibrated(h)) return null;

  const faded = h.pillars
    .filter((p) => p.status === "lost" || p.status === "faded")
    .sort((a, b) => (a.deltaPts ?? 0) - (b.deltaPts ?? 0));

  if (faded.length) {
    const p = faded[0]!;
    const delta = p.deltaPts != null ? ` (Δ ${p.deltaPts >= 0 ? "+" : ""}${p.deltaPts} pts)` : "";
    return `**Pillar fade** — **${p.label}** drifted ${p.commitLabel} → **${p.currentLabel}**${delta}. ${h.advisory ?? ""}`.trim();
  }

  if (h.moves?.length && !h.moves[0]?.includes("unchanged")) {
    return `**What moved** — ${h.moves.slice(0, 2).join(" · ")}.`;
  }

  if (!thesisHealthUncalibrated(h) && h.health < 55 && h.advisory) {
    return `**Thesis ${h.rungLabel}** (${h.health}%) — ${h.advisory}`;
  }

  return null;
}

/** Trim ladder state, time stop, runner, manage engine. */
export function manageLifecycleCoaching(play: TerminalPlay, bucket: "watch" | "open" | "closed"): string | null {
  if (bucket !== "open") return null;
  const ep = play.exitPolicy;
  const parts: string[] = [];

  if (play.manageAction && play.manageAction !== "HOLD") {
    parts.push(`manage engine **${play.manageAction.replace(/_/g, " ")}**`);
  }

  if (ep?.trim_levels?.length) {
    const fired = ep.trim_levels.filter((t) => t.fired).length;
    const total = ep.trim_levels.length;
    const ladder = ep.trim_levels.map((t) => `+${t.trigger_pct}%${t.fired ? " ✓" : ""}`).join(" · ");
    if (fired > 0 && fired < total) {
      parts.push(`**${fired}/${total} trims banked** — ${ladder}`);
    } else if (fired === total) {
      parts.push(`**all trims banked** — runner only`);
    } else {
      const next = ep.trim_levels.find((t) => !t.fired);
      if (next) parts.push(`next trim at **+${next.trigger_pct}%** (${ladder})`);
    }
  }

  if (ep?.time_stop_et) {
    parts.push(`session exit **${ep.time_stop_et} ET**`);
  }

  if (ep?.runner_fraction != null && ep.runner_fraction > 0) {
    parts.push(`**${Math.round(ep.runner_fraction * 100)}% runner** after trims`);
  }

  const dteMatch = play.contract.match(/(\d+)DTE/);
  if (dteMatch) {
    const dte = Number(dteMatch[1]);
    if (dte <= 7) parts.push(`**${dte} DTE** — theta accelerating; don't over-hold`);
  }

  if (!parts.length) return null;
  return `**Manage plan** — ${parts.join(" · ")}.`;
}

/** WATCH gate unblock path with reasons, not just codes. */
export function watchGateCoaching(play: TerminalPlay): string | null {
  if (!play.gateBlocks?.length) return null;
  const gates = play.gateBlocks
    .slice(0, 3)
    .map((g) => {
      const unlock = g.unlock_et ? ` (clears ~${g.unlock_et} ET)` : "";
      return `**${g.code}**: ${g.reason}${unlock}`;
    })
    .join(" · ");
  return `**Gates blocking entry** — ${gates}.`;
}

/** Gamma magnet pin gravity. */
export function magnetCoaching(vec: VectorFullState | null, spot: number): string | null {
  const m = vec?.magnet;
  if (!m?.strike) return null;
  const lead = m.pull === "at" ? "pinned at" : `pull **${m.pull}** toward`;
  const near = Math.abs(m.distancePct) < 1.2;
  const pin =
    near
      ? "You're sitting on the magnet — expect chop; trim into extensions, don't chase breakouts."
      : "Dealer hedging center of mass — price gravitates here in long-gamma regimes.";
  return `**Gamma magnet ${m.strike.toFixed(2)}** (${fmtPct(m.distancePct)} from spot) — ${lead} this node. ${pin}`;
}

/** Options-implied move envelope — don't chase outside bands. */
export function expectedMoveCoaching(vec: VectorFullState | null, spot: number): string | null {
  const em = vec?.expectedMove;
  const b1 = em?.bands?.find((b) => b.sigma === 1);
  if (!b1) return null;
  const inside = spot >= b1.low && spot <= b1.high;
  const stretch =
    playDirectionHint(spot, b1.high) === "above"
      ? "near upper 1σ — trim longs into strength"
      : playDirectionHint(spot, b1.low) === "below"
        ? "near lower 1σ — watch for bounce or breakdown"
        : "mid-band — room to run inside envelope";
  return (
    `**Expected move 1σ** — **${b1.low.toFixed(2)}–${b1.high.toFixed(2)}** (±${b1.movePts.toFixed(1)} pts). ` +
    `${inside ? "Inside band" : "Outside band"} — ${stretch}.`
  );
}

function playDirectionHint(spot: number, level: number): "above" | "below" | "at" {
  if (Math.abs(spot - level) < 0.05) return "at";
  return spot > level ? "above" : "below";
}

/** Highest-score multi-signal confluence node. */
export function confluenceCoaching(vec: VectorFullState | null, play: TerminalPlay, spot: number): string | null {
  const zones = vec?.confluenceZones ?? [];
  if (!zones.length) return null;
  const top = [...zones].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
  if (!top?.center) return null;
  const kinds = top.kinds?.join(" + ") ?? "multi-signal";
  const dist = ((top.center - spot) / spot) * 100;
  const side = top.center < spot ? "support below" : "resistance above";
  const action =
    play.direction === "LONG"
      ? top.center < spot
        ? "dip-buy zone if thesis intact"
        : "trim zone if rejected"
      : top.center > spot
        ? "fade rallies into this node"
        : "cover if reclaimed";
  return (
    `**Confluence ${top.center.toFixed(2)}** (${kinds}, score ${top.score ?? "—"}) — ${fmtPct(dist)} ${side}. ${action}.`
  );
}

/** Wall integrity — thin walls break easier. */
export function wallIntegrityCoaching(vec: VectorFullState | null, play: TerminalPlay): string | null {
  const wi = vec?.wallIntegrity;
  if (!wi) return null;
  const call = wi.call?.tier;
  const put = wi.put?.tier;
  if (!call && !put) return null;

  if (play.direction === "LONG" && call === "thin") {
    return `**Call wall integrity thin** — upside cap may break easier; don't assume rejection at the wall.`;
  }
  if (play.direction === "SHORT" && put === "thin") {
    return `**Put wall integrity thin** — support may fail fast; cover if floor gives way.`;
  }
  if (call === "firm" || put === "firm") {
    const side = call === "firm" ? "call" : "put";
    return `**${side} wall firm** — expect solid rejection; respect the node on extensions.`;
  }
  return null;
}

/** Vector desk play thesis / invalidation alignment. */
export function vectorPlayCoaching(vec: VectorFullState | null, play: TerminalPlay): string | null {
  const vp = vec?.play;
  if (!vp?.headline && !vp?.invalidation) return null;

  const aligned =
    (play.direction === "LONG" && vp.bias === "long") ||
    (play.direction === "SHORT" && vp.bias === "short");

  const parts: string[] = [];
  if (vp.headline) parts.push(`Vector desk: **${vp.headline}**`);
  if (vp.invalidation) parts.push(`invalidation **${vp.invalidation}**`);
  if (vp.starred?.[0]) parts.push(`starred level **${vp.starred[0]}**`);

  let line = parts.join(" · ");
  if (!aligned && vp.thesis) {
    line += " — **cross-check** Vector thesis vs swing direction.";
  } else if (aligned) {
    line += " — **aligned** with swing lane.";
  }
  return line;
}

/** Night Hawk + 0DTE + HELIX + Vector friction detection. */
export function crossDeskCoaching(ctx: SwingPlayBriefContext, play: TerminalPlay): string | null {
  const eco = ctx.ecosystem;
  const nh = eco?.nighthawk_recent;
  const z = eco?.zerodte_today;
  const flow = eco ? trustedHelixFlow(eco) : null;

  const nhLong = nh?.direction?.toLowerCase() === "long";
  const nhShort = nh?.direction?.toLowerCase() === "short";
  const zLong = z?.direction === "long";
  const zShort = z?.direction === "short";
  const callHeavy = flow && flow.call_premium > flow.put_premium * 1.3;
  const putHeavy = flow && flow.put_premium > flow.call_premium * 1.3;

  const vp = vectorOf(ctx)?.play;
  const vLong = vp?.bias === "long";
  const vShort = vp?.bias === "short";

  const conflicts: string[] = [];
  if (play.direction === "LONG" && nhShort) conflicts.push("Night Hawk bearish");
  if (play.direction === "SHORT" && nhLong) conflicts.push("Night Hawk bullish");
  if (play.direction === "LONG" && zShort) conflicts.push(`0DTE short (score ${z?.score ?? "—"})`);
  if (play.direction === "SHORT" && zLong) conflicts.push(`0DTE long (score ${z?.score ?? "—"})`);
  if (play.direction === "LONG" && vShort) {
    conflicts.push(`Vector bearish (${vp?.headline ?? vp?.grade ?? "desk read"})`);
  }
  if (play.direction === "SHORT" && vLong) {
    conflicts.push(`Vector bullish (${vp?.headline ?? vp?.grade ?? "desk read"})`);
  }
  if (play.direction === "LONG" && putHeavy) conflicts.push("HELIX put-led");
  if (play.direction === "SHORT" && callHeavy) conflicts.push("HELIX call-led");

  if (conflicts.length) {
    return `**Cross-desk friction** — ${conflicts.join(" · ")}. Size down until desks agree.`;
  }

  const aligned: string[] = [];
  if (nh && ((play.direction === "LONG" && nhLong) || (play.direction === "SHORT" && nhShort))) {
    aligned.push(`NH ${nh.conviction}`);
  }
  if (z && ((play.direction === "LONG" && zLong) || (play.direction === "SHORT" && zShort))) {
    aligned.push(`0DTE score ${z.score}`);
  }
  if (aligned.length >= 2) {
    return `**Desk alignment** — ${aligned.join(" + ")} **support** the ${play.direction} swing.`;
  }

  return null;
}

/** Earnings + Meridian catalyst window. */
export function catalystCoaching(ctx: SwingPlayBriefContext): string | null {
  const earnings = ctx.ecosystem?.arsenal?.earnings;
  const meridian = ctx.meridian?.items?.[0];

  if (earnings?.days_until != null && earnings.days_until <= 14) {
    const timing = earnings.report_time ? ` (${earnings.report_time})` : "";
    return (
      `**Earnings in ${earnings.days_until}d** (${earnings.earnings_date}${timing}) — ` +
      `size down or exit before report unless thesis is earnings-driven.`
    );
  }

  if (meridian && meridian.days_until <= 7) {
    const when =
      meridian.days_until <= 0 ? "**today**" : meridian.days_until === 1 ? "**tomorrow**" : `in **${meridian.days_until}d**`;
    const em = meridian.expected_move_pct != null ? ` · implied **${meridian.expected_move_pct.toFixed(1)}%**` : "";
    return `**Catalyst ${when}** — **${meridian.title}** (${meridian.kind}, ${meridian.impact})${em}. Vol can expand — tighten or reduce size.`;
  }

  return null;
}

/** VEX / vanna lens — second-order dealer hedging when it diverges from gamma. */
export function vexCoaching(vec: VectorFullState | null, spot: number | null): string | null {
  if (!vec) return null;
  const vFlip = fin(vec.vexFlip);
  const gFlip = fin(vec.gammaFlip);
  const vCall = vec.vexWalls?.callWalls?.[0]?.strike;
  const vPut = vec.vexWalls?.putWalls?.[0]?.strike;
  if (vFlip == null && vCall == null && vPut == null) return null;

  const parts: string[] = [];
  if (vFlip != null) {
    const above = spot != null ? (spot >= vFlip ? "above" : "below") : null;
    parts.push(`vanna flip **${vFlip.toFixed(2)}**${above ? ` (spot ${above})` : ""}`);
  }
  if (vCall != null) parts.push(`vanna+ wall **${vCall.toFixed(2)}**`);
  if (vPut != null) parts.push(`vanna− wall **${vPut.toFixed(2)}**`);

  let diverge = "";
  if (gFlip != null && vFlip != null && Math.abs(gFlip - vFlip) > 0.5) {
    diverge = " **γ vs vanna diverge** — vanna can accelerate moves gamma alone wouldn't predict.";
  }

  return `**VEX lens** — ${parts.join(" · ")}.${diverge} Watch vanna walls on vol-expansion days.`;
}

/** Large front-expiry flow prints from Vector — institutional tape at strike. */
export function flowPrintsCoaching(vec: VectorFullState | null, play: TerminalPlay): string | null {
  const f = vec?.flowMarkers;
  if (!f?.available || !f.prints?.length) return null;
  const top = f.prints[0]!;
  const aligned =
    (play.direction === "LONG" && top.side?.toLowerCase() === "call") ||
    (play.direction === "SHORT" && top.side?.toLowerCase() === "put");
  const conflict =
    (play.direction === "LONG" && top.side?.toLowerCase() === "put") ||
    (play.direction === "SHORT" && top.side?.toLowerCase() === "call");
  let tail = "";
  if (aligned) tail = " **Aligns** with swing direction.";
  else if (conflict) tail = " **Conflicts** with swing — size down until tape agrees.";
  const more = f.meta.largeFound > f.prints.length ? ` (+${f.meta.largeFound - f.prints.length} more)` : "";
  return (
    `**Large print** — ${top.side} **${top.strike.toFixed(2)}** ${fmtPremium(top.premium)}` +
    `${f.expiry ? ` (${f.expiry})` : ""}${more}.${tail}`
  );
}

/** Macro rates + breadth tone — index-correlated swing context. */
export function macroTapeCoaching(ctx: SwingPlayBriefContext): string | null {
  const arsenal = ctx.ecosystem?.arsenal;
  if (!arsenal) return null;
  const parts: string[] = [];
  if (arsenal.macro) {
    const m = arsenal.macro;
    if (m.yield_10_year != null) parts.push(`10Y **${m.yield_10_year.toFixed(2)}%**`);
    if (m.curve_10y_1y_spread != null) parts.push(`curve **${m.curve_10y_1y_spread.toFixed(2)}**`);
  }
  if (arsenal.breadth?.tone) {
    parts.push(`breadth **${arsenal.breadth.tone}**`);
  }
  if (!parts.length) return null;
  const riskOff = arsenal.breadth?.tone?.toLowerCase().includes("risk-off");
  const riskOn = arsenal.breadth?.tone?.toLowerCase().includes("risk-on");
  const hint =
    ctx.play.direction === "LONG" && riskOff
      ? "Risk-off tape — long swings need tighter stops."
      : ctx.play.direction === "SHORT" && riskOn
        ? "Risk-on tape — shorts face headwind; respect call walls."
        : "Macro context for sizing — not a swing entry trigger alone.";
  return `**Macro tape** — ${parts.join(" · ")}. ${hint}`;
}

/** Ratchet progress along stop→target track. */
export function progressRatchetCoaching(play: TerminalPlay): string | null {
  const p = fin(play.progress);
  if (p == null || play.exitModel !== "RATCHET") return null;
  const pct = Math.round(p * 100);
  const ep = play.exitPolicy;
  let rails = "";
  if (ep?.stop_premium != null && ep?.target_premium != null) {
    rails = ` · rails **${fmtUsd(ep.stop_premium)}** → **${fmtUsd(ep.target_premium)}**`;
  }
  const zone = pct >= 75 ? "near target — trim into strength" : pct <= 25 ? "early in track — let it work" : "mid-track — honor ladder";
  return `**Ratchet progress** — **${pct}%** along stop→target${rails}. ${zone}.`;
}

/** Executable vs mid P&L honesty — slippage on the tape. */
export function execSlippageCoaching(play: TerminalPlay): string | null {
  const mid = fin(play.pnlPct);
  const exec = fin(play.execPnlPct);
  if (mid == null || exec == null) return null;
  const gap = mid - exec;
  if (Math.abs(gap) < 5) return null;
  return (
    `**Executable P&L** — mid **${fmtPct(mid)}** vs fill **${fmtPct(exec)}** ` +
    `(**${gap > 0 ? "-" : "+"}${Math.abs(gap).toFixed(0)}%** slippage). Size exits on the bid, not the mark.`
  );
}

/** Underlying excursion vs option giveback. */
export function underlyingExcursionCoaching(play: TerminalPlay): string | null {
  const stock = fin(play.stockMovePct);
  const peak = fin(play.stockPeakPct);
  const trough = fin(play.stockTroughPct);
  if (stock == null && peak == null && trough == null) return null;
  const parts: string[] = [];
  if (stock != null) parts.push(`stock **${fmtPct(stock)}** since flag`);
  if (peak != null) parts.push(`peak **${fmtPct(peak)}**`);
  if (trough != null) parts.push(`trough **${fmtPct(trough)}**`);
  const optGive =
    play.peak != null && play.pnlPct != null && play.peak - play.pnlPct > 15
      ? ` · option gave back **${(play.peak - play.pnlPct).toFixed(0)}%** from peak`
      : "";
  return `**Underlying tape** — ${parts.join(" · ")}${optGive}. Trade the stock levels, not just premium.`;
}

/** Short interest / days-to-cover — squeeze fuel context. */
export function shortInterestCoaching(ctx: SwingPlayBriefContext, play: TerminalPlay): string | null {
  const fund = ctx.ecosystem?.arsenal?.fundamentals;
  if (!fund?.days_to_cover) return null;
  const dtc = fund.days_to_cover;
  if (dtc < 3) return null;
  if (play.direction === "LONG" && dtc >= 5) {
    return `**Short interest** — **${dtc.toFixed(1)} DTC** · elevated cover risk can fuel squeezes; respect call walls on extensions.`;
  }
  if (play.direction === "SHORT" && dtc >= 8) {
    return `**Crowded short** — **${dtc.toFixed(1)} DTC** · squeeze risk elevated; tighten stops and avoid chasing breakdowns.`;
  }
  return null;
}

/** Calibration scorecard — tier WR when wired. */
export function scorecardCoaching(play: TerminalPlay): string | null {
  const sc = play.scorecard;
  if (!sc || sc.n < 10) return null;
  const wr = Math.round(sc.winRate * 100);
  const ci =
    sc.ciLow != null && sc.ciHigh != null
      ? ` (CI **${Math.round(sc.ciLow * 100)}–${Math.round(sc.ciHigh * 100)}%**)`
      : "";
  const tier = play.tierLabel ? ` **${play.tierLabel}**` : "";
  return (
    `**Playbook stats**${tier} — **${wr}%** WR over **${sc.n}** trades${ci}. ` +
    `Size per calibration; this row is one sample, not the population.`
  );
}

/** IV rank — vol expansion / contraction context. */
export function ivRankCoaching(play: TerminalPlay): string | null {
  const iv = fin(play.ivRank);
  if (iv == null) return null;
  if (iv >= 70) {
    return `**IV rank ${Math.round(iv)}** — vol elevated; trims into strength matter — theta + crush risk on hold.`;
  }
  if (iv <= 25) {
    return `**IV rank ${Math.round(iv)}** — vol cheap; upside needs underlying move, not vol expansion alone.`;
  }
  return null;
}

/** Recent wall dynamics — last 2 bead events for live structure shifts. */
export function wallDynamicsCoaching(vec: VectorFullState | null): string | null {
  const events = vec?.wallEvents ?? [];
  if (events.length < 2) return null;
  const recent = events.slice(-2);
  const lines = recent.map((w) => `${w.kind.replace(/_/g, " ")}: ${w.message}`).join(" · ");
  return `**Wall dynamics** — ${lines}. Structure shifting — re-check break levels.`;
}

/** Morning-confirm / legacy pre-market gate coaching on WATCH rows. */
export function morningConfirmCoaching(play: TerminalPlay): string | null {
  if (play.pulled || play.morningStatus === "INVALIDATED") {
    const reason = play.morningReason ? ` — ${play.morningReason}` : "";
    return `**Morning confirm FAILED**${reason}. Do not enter; setup invalidated.`;
  }
  if (play.morningStatus === "DEGRADED") {
    return `**Pre-market DEGRADED** — validate gates before entry; size down vs full signal.`;
  }
  if (play.morningStatus === "UNVERIFIED") {
    return `**Morning unverified** — wait for CONFIRMED status before sizing.`;
  }
  if (play.morningStatus === "CONFIRMED" && play.status === "WATCH") {
    return `**Pre-market CONFIRMED** — mechanical gates cleared; wait for trigger geometry.`;
  }
  return null;
}

export function laneRankCoaching(play: TerminalPlay, laneRows: SwingPlayBriefContext["laneRows"]): string | null {
  const snap = computeLaneRank(play, laneRows);
  if (!snap || snap.total < 2) return null;

  const label = snap.bucket === "open" ? "OPEN" : "WATCH";
  if (snap.rank === 1) {
    return `**Lane leader** — **#1 of ${snap.total}** on ${label} (score **${snap.playScore}**). Desk attention follows the top row.`;
  }
  if (snap.deltaFromMedian < -15) {
    return (
      `**Below lane median** — **#${snap.rank}/${snap.total}** (score **${snap.playScore}**, ` +
      `${snap.deltaFromMedian} vs median). Leader: **${snap.topTicker ?? "—"}** @ **${snap.topScore ?? "—"}** — confirm before adding size.`
    );
  }
  if (snap.rank <= 3 && snap.deltaFromMedian >= 10) {
    return `**Top-tier setup** — **#${snap.rank}/${snap.total}** on ${label} · **+${snap.deltaFromMedian}** vs median.`;
  }
  return null;
}

/** Chart technicals one-liner — RSI / VWAP / structure. */
export function technicalsCoaching(vec: VectorFullState | null, play: TerminalPlay): string | null {
  const t = vec?.technicals;
  if (!t) return null;
  const parts: string[] = [];
  if (t.vwap != null && vec?.spot != null) {
    const above = vec.spot >= t.vwap;
    parts.push(`VWAP **${t.vwap.toFixed(2)}** (${above ? "above" : "below"} spot)`);
  }
  if (t.rsi != null) {
    const zone = t.rsi > 70 ? "overbought" : t.rsi < 30 ? "oversold" : "neutral";
    parts.push(`RSI **${Math.round(t.rsi)}** (${zone})`);
  }
  if (t.emaStack) {
    const word = t.emaStack === "up" ? "bull stack" : t.emaStack === "down" ? "bear stack" : "mixed EMAs";
    parts.push(word);
  }
  if (t.structure?.type) {
    parts.push(
      `structure **${t.structure.type.replace(/_/g, " ")} ${t.structure.direction}** @ **${t.structure.level.toFixed(2)}**`,
    );
  }
  if (!parts.length) return null;

  const chartBias = technicalsBias(t, vec?.spot ?? null);
  const biasLabel =
    chartBias === "bullish"
      ? "chart reads bullish"
      : chartBias === "bearish"
        ? "chart reads bearish"
        : "mixed chart read";
  const aligned =
    (play.direction === "LONG" && chartBias === "bullish") ||
    (play.direction === "SHORT" && chartBias === "bearish");
  const conflicts =
    (play.direction === "LONG" && chartBias === "bearish") ||
    (play.direction === "SHORT" && chartBias === "bullish");
  const alignment = aligned
    ? "aligns with swing direction"
    : conflicts
      ? "conflicts with swing direction"
      : null;
  return `**Chart read** — ${parts.join(" · ")} — ${biasLabel}${alignment ? ` (${alignment})` : ""}.`;
}

/** Data honesty — stale marks, quiet HELIX, old Vector. */
export function dataHonestyCoaching(ctx: SwingPlayBriefContext, play: TerminalPlay): string | null {
  const vec = vectorOf(ctx);
  const warnings: string[] = [];

  // markIsSync === true means no markAsOf timestamp (sync quote without freshness) — same polarity as dataFreshnessSection.
  if (play.markIsSync === true && playExpectsLiveOptionMark(play.status)) {
    warnings.push("mark not synced to live tape");
  } else if (optionMarkIsStale(play)) {
    warnings.push("option mark stale — P&L may lag live tape");
  }
  if (vec?.dataAgeMs != null && vec.dataAgeMs > 120_000) {
    warnings.push(`Vector **${Math.round(vec.dataAgeMs / 1000)}s** stale`);
  }
  if (ctx.ecosystem?.flow_feed_fresh === false) {
    warnings.push(
      "HELIX pipeline stale — flow read unavailable, not evidence of quiet tape",
    );
  }
  if (
    ctx.scanSessionDay &&
    ctx.sessionDate &&
    ctx.scanSessionDay !== ctx.sessionDate
  ) {
    warnings.push(
      `swing discovery from **${ctx.scanSessionDay}** — today's scan not yet run`,
    );
  }

  if (!warnings.length) return null;
  return `**Data caveat** — ${warnings.join(" · ")}. Treat levels as indicative until refresh.`;
}

/** Closed play post-mortem coaching. */
export function closedCoaching(play: TerminalPlay): string | null {
  if (play.status !== "CLOSED") return null;
  const lines: string[] = [];

  if (play.peak != null && play.exitPnlPct != null) {
    const outcome = mfeCaptureOutcome(play.exitPnlPct, play.peak, play.mfeCapturePct);
    lines.push(`Exited **${fmtPct(play.exitPnlPct)}** vs peak **${fmtPct(play.peak)}**`);
    if (outcome?.kind === "round_trip") {
      lines.push(`**Round-tripped past breakeven** — was up **${fmtPct(outcome.peakPct)}** at peak, closed at **${fmtPct(outcome.exitPnlPct)}**; tighten at first trim rail next time.`);
    } else if (outcome?.kind === "capture") {
      const capture = outcome.capturePct;
      if (capture >= 75) lines.push(`**Strong discipline** — captured **${fmtPct(capture)}** of peak; replicate trim timing.`);
      else if (capture < 35 && play.peak > 20) lines.push(`**Gave back the move** — only **${fmtPct(capture)}** MFE capture; tighten at first trim rail next time.`);
      else lines.push(`MFE capture **${fmtPct(capture)}** — review runner vs trim policy.`);
    }
  }

  if (play.closedReason) {
    const r = play.closedReason.replace(/_/g, " ");
    if (play.closedReason === "thesis") lines.push(`Exit on **thesis break** — note which pillar failed first in playbook review.`);
    else if (play.closedReason === "stopped" || play.closedReason === "stop") lines.push(`**Stop fired** (${r}) — check if entry was extended past invalidation.`);
    else lines.push(`Exit reason: **${r}**`);
  }

  if (!lines.length) return null;
  return lines.join(" ");
}

/** Collect prioritized coaching bullets for narrative assembly. */
export function collectCoachingBullets(
  ctx: SwingPlayBriefContext,
  bucket: "watch" | "open" | "closed",
  spot: number | null,
): string[] {
  const { play } = ctx;
  const vec = vectorOf(ctx);
  const out: string[] = [];
  const push = (line: string | null | undefined) => {
    if (line) out.push(`• ${line}`);
  };

  if (bucket === "closed") {
    push(closedCoaching(play));
    return out;
  }

  push(thesisBreakCoaching(play));
  push(thesisPillarCoaching(play));

  if (bucket === "watch") {
    push(morningConfirmCoaching(play));
    push(watchGateCoaching(play));
    if (play.flagUnderlyingPx != null) {
      push(`**Flag anchor ${play.flagUnderlyingPx.toFixed(2)}** — track trigger geometry from here.`);
    }
    if (play.entryStatus) {
      push(`**Entry geometry** — ${play.entryStatus.replace(/_/g, " ")}.`);
    }
  }

  push(manageLifecycleCoaching(play, bucket));
  push(catalystCoaching(ctx));
  const earningsItem = ctx.meridian?.items.find((i) => i.kind === "earnings" && i.days_until <= 14) ?? null;
  push(meridianPeerEarningsCoaching(ctx.meridianPeer, earningsItem));
  push(crossDeskCoaching(ctx, play));
  push(laneRankCoaching(play, ctx.laneRows));
  push(macroTapeCoaching(ctx));
  push(scorecardCoaching(play));
  push(progressRatchetCoaching(play));
  push(execSlippageCoaching(play));
  push(underlyingExcursionCoaching(play));
  push(shortInterestCoaching(ctx, play));
  push(ivRankCoaching(play));

  if (spot != null) {
    push(vexCoaching(vec, spot));
    push(flowPrintsCoaching(vec, play));
    push(magnetCoaching(vec, spot));
    push(confluenceCoaching(vec, play, spot));
    push(expectedMoveCoaching(vec, spot));
    push(wallIntegrityCoaching(vec, play));
    push(wallDynamicsCoaching(vec));
    push(technicalsCoaching(vec, play));
  } else {
    push(vexCoaching(vec, null));
    push(flowPrintsCoaching(vec, play));
  }

  push(vectorPlayCoaching(vec, play));
  push(dataHonestyCoaching(ctx, play));

  return out;
}
