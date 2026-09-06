/**
 * Swing play brief — trade-manager narrative.
 * Largo-style coaching bullets: levels, dark pool, GEX king, max pain, flow, hold/break triggers.
 * Pure + deterministic — no LLM.
 */
import type { RichSection } from "@/lib/bie/rich-narrative";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import type { SwingPlayBriefContext } from "./play-brief-types";
import { trustedHelixFlow } from "./play-brief-absence";
import type { VectorFullState } from "@/lib/bie/vector-full-state";
import type { VectorDarkPoolLevel } from "@/features/vector/lib/vector-dark-pool-levels";
import { collectCoachingBullets } from "./play-brief-narrative-coaching";

const MAX_BULLETS = 14;

function fin(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function fmtUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${n.toFixed(0)}`;
}

function fmtPct(n: number, digits = 1): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

function distPct(spot: number, level: number): number {
  return ((level - spot) / spot) * 100;
}

function vectorOf(ctx: SwingPlayBriefContext): VectorFullState | null {
  return ctx.vector ?? ctx.ecosystem?.vector_full_state ?? null;
}

type LevelKind = "dark_pool" | "put_wall" | "call_wall" | "gamma_flip" | "king" | "max_pain" | "magnet";

type FocalLevel = {
  price: number;
  kind: LevelKind;
  label: string;
  meta?: string;
  distancePct: number;
};

function collectFocalLevels(ctx: SwingPlayBriefContext, spot: number): FocalLevel[] {
  const vec = vectorOf(ctx);
  const gex = ctx.ecosystem?.gex_positioning;
  const out: FocalLevel[] = [];

  for (const dp of (vec?.darkPoolLevels ?? []).slice(0, 3)) {
    out.push({
      price: dp.strike,
      kind: "dark_pool",
      label: "dark pool",
      meta: `${dp.pct.toFixed(0)}% of DP volume · ${fmtUsd(dp.premium)}`,
      distancePct: distPct(spot, dp.strike),
    });
  }

  const putWall = vec?.gexWalls?.putWalls?.[0]?.strike ?? gex?.put_wall ?? null;
  const callWall = vec?.gexWalls?.callWalls?.[0]?.strike ?? gex?.call_wall ?? null;
  const flip = vec?.gammaFlip ?? gex?.flip ?? null;
  const king = gex?.gex_king_strike ?? vec?.ladder?.rows?.find((r) => r.isKing)?.strike ?? null;
  const maxPain = vec?.maxPain ?? null;
  const magnet = vec?.magnet?.strike ?? null;

  if (putWall != null) {
    out.push({
      price: putWall,
      kind: "put_wall",
      label: "put wall",
      distancePct: distPct(spot, putWall),
    });
  }
  if (callWall != null) {
    out.push({
      price: callWall,
      kind: "call_wall",
      label: "call wall",
      distancePct: distPct(spot, callWall),
    });
  }
  if (flip != null) {
    out.push({
      price: flip,
      kind: "gamma_flip",
      label: "gamma flip",
      distancePct: distPct(spot, flip),
    });
  }
  if (king != null) {
    out.push({
      price: king,
      kind: "king",
      label: "GEX king",
      distancePct: distPct(spot, king),
    });
  }
  if (maxPain != null) {
    out.push({
      price: maxPain,
      kind: "max_pain",
      label: "max pain",
      distancePct: distPct(spot, maxPain),
    });
  }
  if (magnet != null) {
    out.push({
      price: magnet,
      kind: "magnet",
      label: "gamma magnet",
      meta: vec?.magnet?.callout?.slice(0, 80) ?? undefined,
      distancePct: distPct(spot, magnet),
    });
  }

  return out.sort((a, b) => Math.abs(a.distancePct) - Math.abs(b.distancePct));
}

function dealerPostureLine(ctx: SwingPlayBriefContext, spot: number): string | null {
  const vec = vectorOf(ctx);
  const posture = vec?.regime?.posture ?? ctx.ecosystem?.gex_positioning?.gamma_posture ?? null;
  const flip = vec?.gammaFlip ?? ctx.ecosystem?.gex_positioning?.flip ?? null;

  if (!posture || posture === "unknown") {
    if (spot != null) return `Spot **${spot.toFixed(2)}** — dealer gamma posture not resolved on this read.`;
    return null;
  }

  const aboveFlip = flip != null ? spot >= flip : null;
  const mechanic =
    posture === "long"
      ? "dealers **long gamma** — dips tend to get bought, range/pin behavior"
      : posture === "short"
        ? "dealers **short gamma** — moves can accelerate through walls"
        : "sitting **at gamma flip** — regime can flip fast";

  const flipBit =
    flip != null
      ? ` · γ-flip **${flip.toFixed(2)}**${aboveFlip != null ? (aboveFlip ? " (spot above)" : " (spot below)") : ""}`
      : "";

  return `**Right now** — spot **${spot.toFixed(2)}** · ${mechanic}${flipBit}`;
}

function narrateDarkPool(level: FocalLevel, play: TerminalPlay, spot: number): string {
  const side = level.price < spot ? "support" : "resistance";
  const hold =
    play.direction === "LONG"
      ? level.price < spot
        ? "defend longs while price holds above"
        : "cap upside until reclaimed"
      : level.price > spot
        ? "cap rallies while below"
        : "lose short thesis if reclaimed";

  return (
    `**Watch ${level.price.toFixed(2)}** — major **dark pool** print (${level.meta ?? "institutional block"}). ` +
    `Institutions stacked here; treat as **${side}**. ${hold.charAt(0).toUpperCase()}${hold.slice(1)}.`
  );
}

function narrateWall(level: FocalLevel, play: TerminalPlay, spot: number): string {
  const isCall = level.kind === "call_wall";
  const near = Math.abs(level.distancePct) < 1.5;
  const verb = isCall ? "caps upside" : "dealer support / put wall";
  const action =
    play.direction === "LONG"
      ? isCall
        ? near
          ? "into strength — trim if rejected here"
          : "resistance overhead — respect on extensions"
        : near
          ? "support underfoot — hold while above"
          : "structural floor — watch for dip-buy into this node"
      : isCall
        ? near
          ? "rejection zone — add on failed reclaim"
          : "target zone for shorts"
        : near
          ? "support too close — invalidates weak short"
          : "break below accelerates";

  return (
    `**${isCall ? "Call" : "Put"} wall ${level.price.toFixed(2)}** (${fmtPct(level.distancePct)} from spot) — ${verb}. ` +
    `${action.charAt(0).toUpperCase()}${action.slice(1)}.`
  );
}

function narrateKing(level: FocalLevel, posture: string | null): string {
  const pin =
    posture === "long"
      ? "Pin risk — dealers hedge into this strike; expect chop around it."
      : "Max-gamma node — moves can accelerate through if wall fades.";
  return `**GEX king ${level.price.toFixed(2)}** — largest gamma concentration on the board. ${pin}`;
}

function narrateMaxPain(level: FocalLevel, spot: number): string {
  const pull = level.price < spot ? "below" : "above";
  return (
    `**Max pain ${level.price.toFixed(2)}** (${fmtPct(level.distancePct)} ${pull} spot) — ` +
    `expiration gravity pulls toward pin when dealers are long gamma; don't fight the pin into close.`
  );
}

function narrateMagnet(level: FocalLevel, posture: string | null): string {
  const pin =
    posture === "long"
      ? "Pin gravity — dealers hedge into this strike; chop likely."
      : "Pivot node — acceleration risk if magnet fails.";
  const meta = level.meta ? ` ${level.meta}` : "";
  return `**Gamma magnet ${level.price.toFixed(2)}** (${fmtPct(level.distancePct)} from spot) — ${pin}${meta}`;
}

function narrateFlip(level: FocalLevel, play: TerminalPlay): string {
  const longBreak =
    play.direction === "LONG"
      ? `Lose **${level.price.toFixed(2)}** → dealer posture turns against longs — tighten or trim.`
      : `Reclaim **${level.price.toFixed(2)}** → invalidates short gamma thesis.`;
  return `**Gamma flip ${level.price.toFixed(2)}** — regime line. ${longBreak}`;
}

function flowNarrative(ctx: SwingPlayBriefContext, play: TerminalPlay): string | null {
  const flow = trustedHelixFlow(ctx.ecosystem);
  if (!flow || flow.print_count === 0) return null;

  const callHeavy = flow.call_premium > flow.put_premium * 1.3;
  const putHeavy = flow.put_premium > flow.call_premium * 1.3;
  const alignedLong = play.direction === "LONG" && callHeavy;
  const alignedShort = play.direction === "SHORT" && putHeavy;
  const conflict = (play.direction === "LONG" && putHeavy) || (play.direction === "SHORT" && callHeavy);

  const bias = callHeavy ? "call-heavy" : putHeavy ? "put-heavy" : "balanced";
  let tape =
    `**HELIX tape** (${flow.window_hours}h) — **${bias}** · calls ${fmtUsd(flow.call_premium)} · puts ${fmtUsd(flow.put_premium)} · ${flow.print_count} prints.`;

  if (alignedLong) tape += " Flow stepping in on the call side **supports** the long swing.";
  else if (alignedShort) tape += " Put flow **aligns** with the short thesis.";
  else if (conflict) tape += " Flow **conflicts** with swing direction — size down until tape agrees.";

  const anomaly = ctx.ecosystem?.recent_anomalies?.[0];
  if (anomaly) {
    tape += ` Latest anomaly: **${anomaly.anomaly_type}** — ${anomaly.detail}.`;
  }

  return tape;
}

function actionNarrative(play: TerminalPlay, bucket: "watch" | "open" | "closed"): string | null {
  if (bucket === "closed") return null;

  const rec = play.recommendation ?? "HOLD";
  const health = play.thesisHealth?.health;
  const lines: string[] = [];

  if (bucket === "watch") {
    const gateLine = play.gateBlocks?.length
      ? play.gateBlocks
          .slice(0, 2)
          .map((g) => `${g.code}: ${g.reason}`)
          .join(" · ")
      : null;
    lines.push(
      `**Entry stance** — ${play.swingEntryAction?.toUpperCase() ?? rec}. ` +
        (gateLine
          ? `Clear gates: ${gateLine}.`
          : rec === "BUY"
            ? "No mechanical gates blocking — wait for trigger geometry."
            : "Wait for setup maturity before sizing."),
    );
    return lines.join(" ");
  }

  if (rec === "TRIM") {
    const next = play.exitPolicy?.trim_levels?.find((t) => !t.fired);
    lines.push(
      `**Desk says TRIM**${next ? ` — next rail at **+${next.trigger_pct}%**` : ""}. ` +
        `Bank partial into strength; don't give back peak.`,
    );
  } else if (rec === "SELL") {
    lines.push("**Exit now** — thesis or ladder fired. Flatten per manage engine.");
  } else {
    lines.push(
      `**Hold the line**${health != null ? ` — thesis health **${health}%**` : ""}. ` +
        (health != null && health < 45
          ? "Health fading — tighten stop or trim into any bounce."
          : "Let the trade work while structure holds."),
    );
  }

  if (play.peak != null && play.pnlPct != null && play.peak - play.pnlPct > 20) {
    lines.push(
      `Gave back **${(play.peak - play.pnlPct).toFixed(0)}%** from peak — consider protecting runner.`,
    );
  }

  return lines.join(" ");
}

function breakTrigger(play: TerminalPlay, focal: FocalLevel[], flip: number | null): string | null {
  const support = focal.find((l) => l.kind === "put_wall" || l.kind === "dark_pool")?.price;
  const resist = focal.find((l) => l.kind === "call_wall")?.price;

  if (play.direction === "LONG") {
    const stop = support ?? flip;
    if (stop != null) {
      return `**Break watch** — lose **${stop.toFixed(2)}** on a closing basis → structural support failed; exit or cut size.`;
    }
  } else if (play.direction === "SHORT" && resist != null) {
    return `**Break watch** — reclaim **${resist.toFixed(2)}** → resistance broken; cover shorts.`;
  }
  return null;
}

function railsFallback(play: TerminalPlay): string | null {
  const ep = play.exitPolicy;
  if (!ep) return null;
  const trims = ep.trim_levels
    .map((t) => `+${t.trigger_pct}%${t.fired ? " ✓" : ""}`)
    .join(" · ");
  const rails: string[] = [];
  if (trims) rails.push(`trim ladder ${trims}`);
  if (ep.stop_premium != null || ep.target_premium != null) {
    const stop = ep.stop_premium != null ? fmtUsd(ep.stop_premium) : "—";
    const target = ep.target_premium != null ? fmtUsd(ep.target_premium) : "—";
    rails.push(`stop **${stop}** · target **${target}**`);
  }
  if (!rails.length) return null;
  return `**Manage rails** — ${rails.join(" · ")}. Honor stops on closing basis; bank trims into strength.`;
}

/** Steelman the opposing case — honest bear/bull risks for the swing direction. */
export function counterThesisLine(ctx: SwingPlayBriefContext, play: TerminalPlay, spot: number | null): string | null {
  const vec = vectorOf(ctx);
  const eco = ctx.ecosystem;
  const reasons: string[] = [];

  const flow = trustedHelixFlow(eco);
  if (flow) {
    if (play.direction === "LONG" && flow.put_premium > flow.call_premium * 1.2) {
      reasons.push(`HELIX put-led (${fmtUsd(flow.put_premium)} vs ${fmtUsd(flow.call_premium)} calls)`);
    } else if (play.direction === "SHORT" && flow.call_premium > flow.put_premium * 1.2) {
      reasons.push(`HELIX call-led (${fmtUsd(flow.call_premium)} vs ${fmtUsd(flow.put_premium)} puts)`);
    }
  }

  const nh = eco?.nighthawk_recent;
  const z = eco?.zerodte_today;
  if (play.direction === "LONG" && nh?.direction?.toLowerCase() === "short") {
    reasons.push(`Night Hawk bearish (${nh.conviction ?? "recent take"})`);
  } else if (play.direction === "SHORT" && nh?.direction?.toLowerCase() === "long") {
    reasons.push(`Night Hawk bullish (${nh.conviction ?? "recent take"})`);
  }
  if (play.direction === "LONG" && z?.direction === "short") {
    reasons.push(`0DTE short bias (score ${z.score ?? "—"})`);
  } else if (play.direction === "SHORT" && z?.direction === "long") {
    reasons.push(`0DTE long bias (score ${z.score ?? "—"})`);
  }

  const vp = vec?.play;
  if (play.direction === "LONG" && vp?.bias === "short") {
    reasons.push(`Vector bearish (${vp.headline ?? vp.grade ?? "desk read"})`);
  } else if (play.direction === "SHORT" && vp?.bias === "long") {
    reasons.push(`Vector bullish (${vp.headline ?? vp.grade ?? "desk read"})`);
  }

  if (spot != null) {
    const callWall = vec?.gexWalls?.callWalls?.[0]?.strike ?? eco?.gex_positioning?.call_wall ?? null;
    const putWall = vec?.gexWalls?.putWalls?.[0]?.strike ?? eco?.gex_positioning?.put_wall ?? null;
    if (play.direction === "LONG" && callWall != null && callWall > spot) {
      const d = distPct(spot, callWall);
      if (d < 3) reasons.push(`call wall **${callWall.toFixed(2)}** overhead (${d.toFixed(1)}%)`);
    }
    if (play.direction === "SHORT" && putWall != null && putWall < spot) {
      const d = Math.abs(distPct(spot, putWall));
      if (d < 3) reasons.push(`put wall **${putWall.toFixed(2)}** below (${d.toFixed(1)}%)`);
    }
  }

  const ema = vec?.technicals?.emaStack ?? null;
  if (play.direction === "LONG" && ema === "down") reasons.push("bear EMA stack on chart");
  if (play.direction === "SHORT" && ema === "up") reasons.push("bull EMA stack on chart");

  const posture = vec?.regime?.posture ?? eco?.gex_positioning?.gamma_posture ?? null;
  if (play.direction === "LONG" && posture === "long") reasons.push("dealer long-gamma pins rallies");
  if (play.direction === "SHORT" && posture === "short") reasons.push("dealer short-gamma can squeeze shorts");

  const faded = play.thesisHealth?.pillars?.find((p) => p.status === "lost" || p.status === "faded");
  if (faded && (!play.thesisBreak?.level || play.thesisBreak.level === "intact")) {
    reasons.push(`fading pillar **${faded.label}**`);
  }

  if (!reasons.length) return null;

  const side = play.direction === "LONG" ? "bear" : "bull";
  return `**Counter-thesis (${side} case)** — ${reasons.slice(0, 3).join(" · ")}. If this wins, honor invalidation — don't hope.`;
}

function degradedReadLine(play: TerminalPlay, bucket: "watch" | "open" | "closed"): string | null {
  if (bucket === "closed") return null;
  const rec = play.recommendation ?? play.swingEntryAction?.toUpperCase() ?? "HOLD";
  const health = play.thesisHealth?.health;
  const pnl = fin(play.pnlPct);
  const peak = fin(play.peak);
  const giveback = pnl != null && peak != null && peak - pnl > 15 ? ` · gave back **${(peak - pnl).toFixed(0)}%** from peak` : "";
  const healthBit = health != null ? ` · thesis **${health}%**` : "";
  const markBit = play.mark != null ? ` · mark **${fmtUsd(play.mark)}**` : "";
  return `**Live read** — Vector spot not wired on this tick; desk still says **${rec}**${healthBit}${markBit}${giveback}. Levels refresh on next poll.`;
}

/** Largo-style trade manager narration — levels, flow, hold/break coaching. */
export function tradeManagerNarrativeSection(
  ctx: SwingPlayBriefContext,
  bucket: "watch" | "open" | "closed",
): RichSection | null {
  const { play } = ctx;
  const vec = vectorOf(ctx);
  const spot = fin(vec?.spot) ?? fin(ctx.ecosystem?.gex_positioning?.spot);

  const bullets: string[] = [];
  const seen = new Set<string>();
  // Break watch + counter-thesis bypass MAX_BULLETS — safety-critical coaching must not
  // starve when collectCoachingBullets + focal levels fill the cap (CTO audit #14).
  const add = (line: string, opts?: { reserved?: boolean }) => {
    const key = line.slice(0, 48);
    if (seen.has(key)) return;
    if (!opts?.reserved && bullets.length >= MAX_BULLETS) return;
    seen.add(key);
    bullets.push(line.startsWith("• ") ? line : `• ${line}`);
  };

  if (bucket === "closed") {
    for (const line of collectCoachingBullets(ctx, bucket, spot)) add(line);
    if (!bullets.length) return null;
    return { title: "Trade manager read", body: bullets.join("\n"), bias: "neutral" };
  }

  const action = actionNarrative(play, bucket);
  if (action) add(action);

  for (const line of collectCoachingBullets(ctx, bucket, spot)) add(line);

  if (spot != null) {
    const posture = dealerPostureLine(ctx, spot);
    if (posture) add(posture);
  } else {
    const degraded = degradedReadLine(play, bucket);
    if (degraded) add(degraded);
    if (!bullets.some((b) => /Manage plan/i.test(b))) {
      const rails = railsFallback(play);
      if (rails) add(rails);
    }
  }

  if (spot != null) {
    const focal = collectFocalLevels(ctx, spot);
    const used = new Set<LevelKind>();

    for (const level of focal) {
      if (bullets.length >= MAX_BULLETS) break;
      if (level.kind === "dark_pool" && !used.has("dark_pool")) {
        add(narrateDarkPool(level, play, spot));
        used.add("dark_pool");
      } else if (level.kind === "put_wall" && !used.has("put_wall")) {
        add(narrateWall(level, play, spot));
        used.add("put_wall");
      } else if (level.kind === "call_wall" && !used.has("call_wall")) {
        add(narrateWall(level, play, spot));
        used.add("call_wall");
      } else if (level.kind === "magnet" && !used.has("magnet") && !bullets.some((b) => /Gamma magnet/i.test(b))) {
        const posture = vec?.regime?.posture ?? ctx.ecosystem?.gex_positioning?.gamma_posture ?? null;
        add(narrateMagnet(level, posture));
        used.add("magnet");
      } else if (level.kind === "king" && !used.has("king")) {
        const posture = vec?.regime?.posture ?? ctx.ecosystem?.gex_positioning?.gamma_posture ?? null;
        add(narrateKing(level, posture));
        used.add("king");
      } else if (level.kind === "max_pain" && !used.has("max_pain")) {
        add(narrateMaxPain(level, spot));
        used.add("max_pain");
      } else if (level.kind === "gamma_flip" && !used.has("gamma_flip") && Math.abs(level.distancePct) < 3) {
        add(narrateFlip(level, play));
        used.add("gamma_flip");
      }
    }

    const prox = vec?.proximity;
    if (prox?.callout && bullets.length < MAX_BULLETS) {
      add(`**Nearest wall ${prox.strike.toFixed(2)}** (${prox.side}) — ${prox.callout}`);
    }

    const walls = vec?.wallEvents ?? [];
    if (walls[0] && bullets.length < MAX_BULLETS) {
      const w = walls[walls.length - 1]!;
      add(`**Wall just moved** — ${w.kind.replace(/_/g, " ")}: ${w.message}`);
    }
  }

  const flow = flowNarrative(ctx, play);
  if (flow && !bullets.some((b) => /HELIX tape/i.test(b))) add(flow);

  const flip = fin(vec?.gammaFlip) ?? fin(ctx.ecosystem?.gex_positioning?.flip);
  const focal = spot != null ? collectFocalLevels(ctx, spot) : [];
  let breakLine = breakTrigger(play, focal, flip);
  if (!breakLine && play.direction === "LONG" && play.exitPolicy?.stop_premium != null) {
    breakLine = `**Break watch** — lose premium stop **${fmtUsd(play.exitPolicy.stop_premium)}** → cut size or exit.`;
  } else if (!breakLine && play.direction === "SHORT" && play.exitPolicy?.stop_premium != null) {
    breakLine = `**Break watch** — reclaim **${fmtUsd(play.exitPolicy.stop_premium)}** → cover shorts.`;
  }
  if (breakLine) add(breakLine, { reserved: true });

  const counter = counterThesisLine(ctx, play, spot);
  if (counter) add(counter, { reserved: true });

  if (!bullets.length) return null;

  const bias =
    play.direction === "SHORT"
      ? "bearish"
      : play.direction === "LONG"
        ? play.thesisHealth?.health != null && play.thesisHealth.health < 45
          ? "neutral"
          : "bullish"
        : "neutral";

  return {
    title: "Trade manager read",
    body: bullets.join("\n"),
    bias,
  };
}

/** Export for tests — top dark pool level narration. */
export function describeDarkPoolLevel(
  level: VectorDarkPoolLevel,
  spot: number,
  direction: TerminalPlay["direction"],
): string {
  return narrateDarkPool(
    {
      price: level.strike,
      kind: "dark_pool",
      label: "dark pool",
      meta: `${level.pct.toFixed(0)}% of DP volume · ${fmtUsd(level.premium)}`,
      distancePct: distPct(spot, level.strike),
    },
    { direction } as TerminalPlay,
    spot,
  );
}
