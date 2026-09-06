/**
 * Extended trade-manager coaching bullets — folds intel-section data into Largo narrative.
 * Pure + deterministic. Consumed by play-brief-narrative.ts.
 */
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import type { SwingPlayBriefContext } from "./play-brief-types";
import type { VectorFullState } from "@/lib/bie/vector-full-state";
import { computeLaneRank } from "./play-brief-lane-rank";

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

  if (h.health < 55 && h.advisory) {
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
    (play.direction === "LONG" && vp.thesis?.toLowerCase().includes("long")) ||
    (play.direction === "SHORT" && vp.thesis?.toLowerCase().includes("short"));

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
  return line.startsWith("Vector") ? `**${line}` : line;
}

/** Night Hawk + 0DTE + HELIX friction detection. */
export function crossDeskCoaching(ctx: SwingPlayBriefContext, play: TerminalPlay): string | null {
  const eco = ctx.ecosystem;
  if (!eco) return null;

  const nh = eco.nighthawk_recent;
  const z = eco.zerodte_today;
  const flow = eco.recent_flow;

  const nhLong = nh?.direction?.toLowerCase() === "long";
  const nhShort = nh?.direction?.toLowerCase() === "short";
  const zLong = z?.direction === "long";
  const zShort = z?.direction === "short";
  const callHeavy = flow && flow.call_premium > flow.put_premium * 1.3;
  const putHeavy = flow && flow.put_premium > flow.call_premium * 1.3;

  const conflicts: string[] = [];
  if (play.direction === "LONG" && nhShort) conflicts.push("Night Hawk bearish");
  if (play.direction === "SHORT" && nhLong) conflicts.push("Night Hawk bullish");
  if (play.direction === "LONG" && zShort) conflicts.push(`0DTE short (score ${z?.score ?? "—"})`);
  if (play.direction === "SHORT" && zLong) conflicts.push(`0DTE long (score ${z?.score ?? "—"})`);
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

/** Lane rank vs peers — attention allocation coaching. */
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

  const bias =
    play.direction === "LONG" && (t.emaStack === "up" || (t.rsi != null && t.rsi < 65))
      ? "supports long swing"
      : play.direction === "SHORT" && (t.emaStack === "down" || (t.rsi != null && t.rsi > 35))
        ? "supports short swing"
        : "mixed vs swing direction";
  return `**Chart read** — ${parts.join(" · ")} — ${bias}.`;
}

/** Data honesty — stale marks, quiet HELIX, old Vector. */
export function dataHonestyCoaching(ctx: SwingPlayBriefContext, play: TerminalPlay): string | null {
  const vec = vectorOf(ctx);
  const warnings: string[] = [];

  if (play.markIsSync === false) warnings.push("mark not synced to live tape");
  if (vec?.dataAgeMs != null && vec.dataAgeMs > 120_000) {
    warnings.push(`Vector **${Math.round(vec.dataAgeMs / 1000)}s** stale`);
  }
  if (ctx.ecosystem?.flow_feed_fresh === false) {
    warnings.push("HELIX feed quiet — flow read may lag");
  }

  if (!warnings.length) return null;
  return `**Data caveat** — ${warnings.join(" · ")}. Treat levels as indicative until refresh.`;
}

/** Closed play post-mortem coaching. */
export function closedCoaching(play: TerminalPlay): string | null {
  if (play.status !== "CLOSED") return null;
  const lines: string[] = [];

  if (play.peak != null && play.exitPnlPct != null) {
    const capture =
      play.mfeCapturePct != null
        ? play.mfeCapturePct
        : play.peak > 0
          ? (play.exitPnlPct / play.peak) * 100
          : null;
    lines.push(`Exited **${fmtPct(play.exitPnlPct)}** vs peak **${fmtPct(play.peak)}**`);
    if (capture != null) {
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
  push(crossDeskCoaching(ctx, play));
  push(laneRankCoaching(play, ctx.laneRows));

  if (spot != null) {
    push(magnetCoaching(vec, spot));
    push(confluenceCoaching(vec, play, spot));
    push(expectedMoveCoaching(vec, spot));
    push(wallIntegrityCoaching(vec, play));
    push(technicalsCoaching(vec, play));
  }

  push(vectorPlayCoaching(vec, play));
  push(dataHonestyCoaching(ctx, play));

  return out;
}
