/**
 * Swing Play Intelligence — rich deterministic sections.
 * Surfaces chart technicals, flow, GEX nodes, catalysts, watch levels, and hold plan.
 */
import type { RichSection } from "@/lib/bie/rich-narrative";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import type { SwingPlayBriefContext } from "./play-brief-types";
import type { VectorFullState } from "@/lib/bie/vector-full-state";
import type { EcosystemContext } from "@/lib/bie/ecosystem-context";
import type { ConfluenceZone } from "@/features/vector/lib/vector-confluence";

function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
}

function fmtDist(spot: number, level: number): string {
  const pct = ((level - spot) / spot) * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}% (${fmtUsd(level - spot)} from spot)`;
}

function statusBucket(play: TerminalPlay): "watch" | "open" | "closed" {
  if (play.status === "CLOSED") return "closed";
  if (play.status === "OPEN" || play.status === "HOLD" || play.status === "TRIM") return "open";
  return "watch";
}

function vectorOf(ctx: SwingPlayBriefContext): VectorFullState | null {
  return ctx.vector ?? ctx.ecosystem?.vector_full_state ?? null;
}

/** Score pillars with signal provenance — the "why" behind the grade. */
export function whyThisSetupSection(play: TerminalPlay): RichSection {
  const lines: string[] = [];
  if (play.discoveryOrigin?.length) {
    lines.push(`**Signals fired:** ${play.discoveryOrigin.join(" · ")}`);
  }
  if (play.archetype) lines.push(`**Archetype:** ${play.archetype.replace(/_/g, " ")}`);
  if (play.regime) lines.push(play.regime);
  if (play.recNote && play.status !== "CLOSED") lines.push(play.recNote);

  if (play.factors.length) {
    const factorLines = play.factors
      .slice(0, 10)
      .map((f) => `• **${f.label}** — ${f.points >= 0 ? "+" : ""}${f.points} pts`)
      .join("\n");
    lines.push("**Score pillars:**\n" + factorLines);
  } else {
    lines.push("No pillar breakdown on this row — grade is from lane score only.");
  }

  if (play.servingSection) {
    lines.push(`Desk section: **${play.servingSection.replace(/_/g, " ")}**`);
  }
  if (play.setupState) lines.push(`Setup maturity: **${play.setupState}**`);

  return { title: "Why this setup", body: lines.join("\n\n") };
}

/** Vector chart technicals — EMA stack, VWAP, RSI, MACD, structure. */
export function chartTechnicalsSection(vec: VectorFullState | null, play: TerminalPlay): RichSection | null {
  if (!vec?.technicals && vec?.spot == null) return null;
  const t = vec.technicals;
  const lines: string[] = [];
  if (vec.spot != null) lines.push(`Spot: **${vec.spot.toFixed(2)}**`);
  if (t?.emaStack) lines.push(`EMA 9/21/50 stack: **${t.emaStack}**`);
  if (t?.vwap != null) {
    const side = vec.spot != null && vec.spot >= t.vwap ? "above" : "below";
    lines.push(`VWAP **${t.vwap.toFixed(2)}** — price ${side} session VWAP`);
  }
  if (t?.rsi != null) lines.push(`RSI: **${t.rsi.toFixed(0)}**`);
  if (t?.macd) lines.push(`MACD: **${t.macd}**`);
  if (t?.goldenPocket) {
    lines.push(`Golden pocket: **${t.goldenPocket.low.toFixed(2)}–${t.goldenPocket.high.toFixed(2)}**`);
  }
  if (t?.structure) {
    lines.push(
      `Structure: **${t.structure.type}** ${t.structure.direction} @ **${t.structure.level.toFixed(2)}**`,
    );
  }
  if (vec.regime?.posture) lines.push(`Vector regime: **${vec.regime.posture}**`);
  if (vec.play?.grade) lines.push(`Vector desk grade: **${vec.play.grade}**`);
  if (!lines.length) return null;
  return {
    title: "Chart technicals",
    body: lines.join("\n"),
    bias: play.direction === "SHORT" ? "bearish" : play.direction === "LONG" ? "bullish" : "neutral",
  };
}

function formatConfluenceZone(z: ConfluenceZone, spot: number | null): string {
  const kinds = z.kinds.join("+");
  const dist = spot != null ? ` · ${fmtDist(spot, z.center)}` : "";
  return `• **${z.center.toFixed(2)}** (${kinds}, score ${z.score.toFixed(0)})${dist}`;
}

/** GEX walls, flip, max pain, expected move, confluence nodes. */
export function chartLevelsSection(ctx: SwingPlayBriefContext): RichSection | null {
  const vec = vectorOf(ctx);
  const eco = ctx.ecosystem;
  const gex = eco?.gex_positioning;
  const spot = vec?.spot ?? gex?.spot ?? null;
  const lines: string[] = [];

  const callWall = vec?.gexWalls?.call_wall ?? gex?.call_wall ?? null;
  const putWall = vec?.gexWalls?.put_wall ?? gex?.put_wall ?? null;
  const flip = vec?.gammaFlip ?? gex?.flip ?? null;

  if (callWall != null) {
    lines.push(`**Call wall (GEX):** ${callWall.toFixed(2)}${spot != null ? ` — ${fmtDist(spot, callWall)}` : ""}`);
  }
  if (putWall != null) {
    lines.push(`**Put wall (GEX):** ${putWall.toFixed(2)}${spot != null ? ` — ${fmtDist(spot, putWall)}` : ""}`);
  }
  if (flip != null) {
    lines.push(`**Gamma flip:** ${flip.toFixed(2)}${spot != null ? ` — ${fmtDist(spot, flip)}` : ""}`);
  }
  if (gex?.gex_king_strike != null) {
    lines.push(`GEX king strike: **${gex.gex_king_strike.toFixed(2)}**`);
  }
  if (vec?.maxPain != null) {
    lines.push(`Max pain: **${vec.maxPain.toFixed(2)}**`);
  }
  if (vec?.expectedMove?.bands?.length) {
    const bandStr = vec.expectedMove.bands
      .slice(0, 2)
      .map((b) => `${b.sigma}σ ${b.low.toFixed(2)}–${b.high.toFixed(2)}`)
      .join(" · ");
    lines.push(`Expected move: **${bandStr}**`);
  }
  if (vec?.proximity?.strike != null) {
    lines.push(
      `Nearest wall: **${vec.proximity.strike.toFixed(2)}** (${vec.proximity.side}, ${vec.proximity.distancePct.toFixed(1)}% away) — ${vec.proximity.callout}`,
    );
  }
  const zones = vec?.confluenceZones ?? [];
  if (zones.length) {
    const top = [...zones].sort((a, b) => b.score - a.score).slice(0, 4);
    lines.push("**Confluence nodes:**\n" + top.map((z) => formatConfluenceZone(z, spot)).join("\n"));
  }
  const dp = vec?.darkPoolLevels ?? [];
  if (dp.length) {
    lines.push(
      "**Dark pool levels:** " +
        dp
          .slice(0, 3)
          .map((l) => `${l.strike.toFixed(2)} (${l.premium != null ? fmtUsd(l.premium) : "—"})`)
          .join(" · "),
    );
  }
  if (!lines.length) return null;
  return { title: "Levels on chart", body: lines.join("\n\n") };
}

/** HELIX flow, anomalies, tape prints near GEX nodes. */
export function flowIntelSection(eco: EcosystemContext | null, play: TerminalPlay): RichSection | null {
  if (!eco) return null;
  const lines: string[] = [];

  if (eco.recent_flow) {
    const f = eco.recent_flow;
    const bias =
      f.call_premium > f.put_premium * 1.3
        ? "call-heavy"
        : f.put_premium > f.call_premium * 1.3
          ? "put-heavy"
          : "balanced";
    lines.push(
      `HELIX tape (${f.window_hours}h): **${bias}** — calls ${fmtUsd(f.call_premium)} · puts ${fmtUsd(f.put_premium)} · ${f.print_count} prints`,
    );
  }

  if (eco.recent_anomalies?.length) {
    const anomalies = eco.recent_anomalies
      .slice(0, 4)
      .map((a) => `• **${a.anomaly_type}** — ${a.detail}${a.direction ? ` (${a.direction})` : ""}`)
      .join("\n");
    lines.push("**Flow anomalies:**\n" + anomalies);
  }

  const recent = eco.flow_full_state?.recent ?? [];
  if (recent.length) {
    const prints = recent
      .slice(0, 5)
      .map((p) => {
        const prem = p.premium != null ? fmtUsd(p.premium) : "—";
        const gex = p.gex_proximity ? ` @ ${p.gex_proximity.replace(/_/g, " ")}` : "";
        return `• ${p.option_type ?? "—"} ${p.strike ?? "—"} ${prem}${gex}`;
      })
      .join("\n");
    lines.push("**Recent prints:**\n" + prints);
  }

  if (eco.zerodte_today) {
    const z = eco.zerodte_today;
    const aligned =
      (play.direction === "LONG" && z.direction === "long") ||
      (play.direction === "SHORT" && z.direction === "short");
    lines.push(
      `0DTE desk: **${z.direction}** · ${z.conviction ?? "—"} conviction${aligned ? " · **aligned**" : " · **conflict** with swing direction"}`,
    );
  }

  if (!lines.length) return null;
  return { title: "Flow & positioning", body: lines.join("\n\n") };
}

/** Earnings, news, short interest, peers. */
export function catalystsSection(eco: EcosystemContext | null): RichSection | null {
  const arsenal = eco?.arsenal;
  if (!arsenal) return null;
  const lines: string[] = [];

  if (arsenal.earnings?.earnings_date) {
    const d = arsenal.earnings.days_until;
    const when =
      d != null && d <= 0
        ? "**today**"
        : d != null && d === 1
          ? "**tomorrow**"
          : d != null
            ? `in **${d} days**`
            : "";
    lines.push(
      `Earnings: **${arsenal.earnings.earnings_date}** ${when}${arsenal.earnings.report_time ? ` (${arsenal.earnings.report_time})` : ""}`,
    );
  }

  if (arsenal.fundamentals) {
    const f = arsenal.fundamentals;
    const parts: string[] = [];
    if (f.days_to_cover != null) parts.push(`short DTC **${f.days_to_cover.toFixed(1)}d**`);
    if (f.short_volume_ratio != null) parts.push(`short vol ratio **${(f.short_volume_ratio * 100).toFixed(0)}%**`);
    if (parts.length) lines.push(parts.join(" · "));
  }

  if (arsenal.news?.headlines?.length) {
    lines.push(
      "**Headlines:**\n" +
        arsenal.news.headlines
          .slice(0, 4)
          .map((h) => `• ${h}`)
          .join("\n"),
    );
  } else if (arsenal.news?.count === 0) {
    lines.push("No recent ticker news in feed.");
  }

  if (arsenal.related?.length) {
    lines.push(`Peers: ${arsenal.related.slice(0, 6).join(", ")}`);
  }

  if (!lines.length) return null;
  return { title: "Catalysts & news", body: lines.join("\n\n") };
}

/** What to watch — invalidation, triggers, key levels. */
export function watchForSection(ctx: SwingPlayBriefContext, bucket: "watch" | "open" | "closed"): RichSection {
  const { play } = ctx;
  const vec = vectorOf(ctx);
  const spot = vec?.spot ?? ctx.ecosystem?.gex_positioning?.spot ?? null;
  const lines: string[] = [];

  if (bucket === "watch") {
    if (play.gateBlocks?.length) {
      lines.push(
        "**Before entry, clear:**\n" + play.gateBlocks.map((g) => `• ${g.code}: ${g.reason}`).join("\n"),
      );
    }
    if (play.entryStatus) lines.push(`Entry geometry: **${play.entryStatus.replace(/_/g, " ")}**`);
    if (play.flagUnderlyingPx != null) {
      lines.push(`Flag anchor: **${play.flagUnderlyingPx.toFixed(2)}** — track move from here`);
    }
  }

  if (play.thesisBreak?.note || play.thesisBreak?.level) {
    lines.push(
      `Thesis **${play.thesisBreak.level ?? "unknown"}**${play.thesisBreak.note ? ` — ${play.thesisBreak.note}` : ""}`,
    );
  }

  const flip = vec?.gammaFlip ?? ctx.ecosystem?.gex_positioning?.flip;
  if (flip != null && spot != null) {
    const watch =
      play.direction === "LONG"
        ? `Lose gamma flip **${flip.toFixed(2)}** — dealer posture turns against longs`
        : `Reclaim gamma flip **${flip.toFixed(2)}** — invalidates short thesis`;
    lines.push(watch);
  }

  const putWall = vec?.gexWalls?.put_wall ?? ctx.ecosystem?.gex_positioning?.put_wall;
  const callWall = vec?.gexWalls?.call_wall ?? ctx.ecosystem?.gex_positioning?.call_wall;
  if (play.direction === "LONG" && putWall != null) {
    lines.push(`Structural support node: put wall **${putWall.toFixed(2)}**`);
  }
  if (play.direction === "SHORT" && callWall != null) {
    lines.push(`Structural resistance node: call wall **${callWall.toFixed(2)}**`);
  }

  if (bucket === "open" && play.exitPolicy?.stop_premium != null) {
    lines.push(`Premium stop rail: **${fmtUsd(play.exitPolicy.stop_premium)}** — thesis breaks if mark closes below`);
  }

  if (!lines.length) {
    lines.push("Watch spot vs gamma flip and nearest GEX wall — no extra triggers wired on this row.");
  }

  return {
    title: bucket === "open" ? "What to watch" : "Watch levels",
    body: lines.join("\n\n"),
    bias: play.thesisBreak?.level === "break" ? "bearish" : "neutral",
  };
}

/** Hold plan — till when, trim ladder, time stops, earnings risk. */
export function holdPlanSection(ctx: SwingPlayBriefContext): RichSection | null {
  const { play, ecosystem } = ctx;
  if (statusBucket(play) !== "open") return null;

  const lines: string[] = [];
  const action = play.recommendation ?? "HOLD";
  lines.push(`**Desk stance:** ${action}`);
  if (play.recNote) lines.push(play.recNote);

  const dteMatch = play.contract.match(/(\d+)DTE/);
  if (dteMatch) {
    const dte = Number(dteMatch[1]);
    lines.push(`Time in trade: **${dte} DTE** on contract — theta accelerates inside ~7 DTE`);
  }

  const earnings = ecosystem?.arsenal?.earnings;
  if (earnings?.days_until != null && earnings.days_until <= 14) {
    lines.push(
      `**Earnings in ${earnings.days_until}d** (${earnings.earnings_date}) — size down or exit before report unless thesis is earnings-driven`,
    );
  }

  if (play.exitPolicy) {
    const ep = play.exitPolicy;
    if (ep.time_stop_et) lines.push(`Session time stop: **${ep.time_stop_et} ET**`);
    const trims = ep.trim_levels
      .map((t) => `+${t.trigger_pct}%${t.fired ? " ✓ banked" : ""}`)
      .join(" · ");
    if (trims) lines.push(`Trim ladder: ${trims}`);
    if (ep.runner_fraction != null) {
      lines.push(`Runner: **${Math.round(ep.runner_fraction * 100)}%** of position after trims`);
    }
    if (ep.stop_premium != null || ep.target_premium != null) {
      lines.push(`Rails: stop **${fmtUsd(ep.stop_premium)}** · target **${fmtUsd(ep.target_premium)}**`);
    }
  }

  if (play.thesisHealth) {
    const h = play.thesisHealth;
    lines.push(`Thesis health **${h.health}%** (${h.rungLabel}) — ${h.advisory ?? "manage per ladder"}`);
    if (h.health < 45) lines.push("**Tighten risk** — thesis fading; don't add size");
    else if (play.peak != null && play.pnlPct != null && play.peak - play.pnlPct > 25) {
      lines.push(`Gave back **${(play.peak - play.pnlPct).toFixed(0)}%** from peak — consider trim into strength`);
    }
  }

  if (play.manageAction) {
    lines.push(`Manage engine: **${play.manageAction.replace(/_/g, " ")}**`);
  }

  return { title: "Hold plan", body: lines.join("\n\n") };
}

/** Post-mortem for closed plays. */
export function lessonsSection(play: TerminalPlay): RichSection | null {
  if (play.status !== "CLOSED") return null;
  const lines: string[] = [];
  if (play.peak != null && play.exitPnlPct != null) {
    const capture =
      play.mfeCapturePct != null
        ? play.mfeCapturePct
        : play.peak > 0
          ? (play.exitPnlPct / play.peak) * 100
          : null;
    lines.push(`Peak was **${fmtPct(play.peak)}** · exited **${fmtPct(play.exitPnlPct)}**`);
    if (capture != null) lines.push(`MFE capture: **${fmtPct(capture)}** of peak move`);
  }
  if (play.closedReason) lines.push(`Exit: **${play.closedReason.replace(/_/g, " ")}**`);
  if (play.archetype) {
    lines.push(`Archetype **${play.archetype.replace(/_/g, " ")}** — review if setup class matched outcome`);
  }
  if (!lines.length) return null;
  return { title: "Lessons", body: lines.join("\n") };
}

/** Build all intelligence sections for the current play state. */
export function buildIntelSections(
  ctx: SwingPlayBriefContext,
  bucket: "watch" | "open" | "closed",
): RichSection[] {
  const { play, ecosystem } = ctx;
  const vec = vectorOf(ctx);
  const out: RichSection[] = [];

  out.push(whyThisSetupSection(play));

  const technicals = chartTechnicalsSection(vec, play);
  if (technicals) out.push(technicals);

  const levels = chartLevelsSection(ctx);
  if (levels) out.push(levels);

  const flow = flowIntelSection(ecosystem, play);
  if (flow) out.push(flow);

  const catalysts = catalystsSection(ecosystem);
  if (catalysts) out.push(catalysts);

  out.push(watchForSection(ctx, bucket));

  if (bucket === "open") {
    const hold = holdPlanSection(ctx);
    if (hold) out.push(hold);
  }

  if (bucket === "closed") {
    const lessons = lessonsSection(play);
    if (lessons) out.push(lessons);
  }

  return out;
}
