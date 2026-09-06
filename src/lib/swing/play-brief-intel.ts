/**
 * Swing Play Intelligence — rich deterministic sections.
 * Surfaces chart technicals, flow, GEX nodes, catalysts, watch levels, and hold plan.
 */
import type { RichSection } from "@/lib/bie/rich-narrative";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import type { SwingPlayBriefContext } from "./play-brief-types";
import type { LargoTimelineItem } from "@/lib/largo/meridian-timeline-for-largo";
import { laneRankSection } from "./play-brief-lane-rank";
import { tradeManagerNarrativeSection } from "./play-brief-narrative";
import type { VectorFullState } from "@/lib/bie/vector-full-state";
import type { EcosystemContext } from "@/lib/bie/ecosystem-context";
import type { ConfluenceZone } from "@/features/vector/lib/vector-confluence";
import { checkPortfolioOverlap, type PortfolioPosition } from "./portfolio";

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

/**
 * Book context — does this candidate stack or fight a theme the member already holds elsewhere?
 * Reuses the same theme resolver the swing entry gate itself uses (`portfolio.ts`/`theme-cluster.ts`,
 * SEV-9), so this reports the SAME partition the gate would flag — not a second, diverging notion
 * of "similar." Only rendered when the book actually overlaps; a clean book says nothing new.
 */
export function bookContextSection(play: TerminalPlay, openBook: PortfolioPosition[] | undefined): RichSection | null {
  if (!openBook?.length) return null;
  const overlap = checkPortfolioOverlap({ ticker: play.ticker, direction: play.direction }, openBook);
  if (!overlap.hasOverlap) return null;

  const lines: string[] = [];
  if (overlap.sameThemeSameDirection.length) {
    const names = overlap.sameThemeSameDirection.map((p) => `${p.ticker} ${p.direction}`).join(", ");
    lines.push(
      `**Concentration** — already holding ${overlap.sameThemeSameDirection.length} same-direction ` +
        `position${overlap.sameThemeSameDirection.length > 1 ? "s" : ""} in theme "${overlap.theme}": ${names}. ` +
        `Adding ${play.ticker} stacks the same wager rather than diversifying risk.`,
    );
  }
  if (overlap.sameThemeOpposedDirection.length) {
    const names = overlap.sameThemeOpposedDirection.map((p) => `${p.ticker} ${p.direction}`).join(", ");
    lines.push(
      `**Internal conflict** — theme "${overlap.theme}" already has an OPPOSED position: ${names}. ` +
        `One leg is structurally betting against the other; this is not a hedge unless intentional.`,
    );
  }

  return { title: "Book context", body: lines.join("\n\n"), bias: "neutral" };
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

  const callWall = vec?.gexWalls?.callWalls?.[0]?.strike ?? gex?.call_wall ?? null;
  const putWall = vec?.gexWalls?.putWalls?.[0]?.strike ?? gex?.put_wall ?? null;
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

  const putWall = vec?.gexWalls?.putWalls?.[0]?.strike ?? ctx.ecosystem?.gex_positioning?.put_wall;
  const callWall = vec?.gexWalls?.callWalls?.[0]?.strike ?? ctx.ecosystem?.gex_positioning?.call_wall;
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

/** Post-mortem for closed plays — MFE capture + archetype learning loop. */
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
    if (capture != null) {
      lines.push(`MFE capture: **${fmtPct(capture)}** of peak move`);
      if (capture >= 75) {
        lines.push("**Strong exit discipline** — banked most of the move; replicate trim ladder timing.");
      } else if (capture < 35 && play.peak > 20) {
        lines.push("**Gave back the move** — next time tighten at first trim rail or thesis fade.");
      } else if (capture >= 35 && capture < 75) {
        lines.push("**Partial capture** — review whether runner policy matched the setup volatility.");
      }
    }
  }
  if (play.closedReason) {
    const reason = play.closedReason.replace(/_/g, " ");
    lines.push(`Exit: **${reason}**`);
    if (play.closedReason === "target" || play.closedReason === "ratchet") {
      lines.push("Mechanical exit fired as designed — thesis or ladder did its job.");
    } else if (play.closedReason === "stopped" || play.closedReason === "stop") {
      lines.push("Stop loss — check if invalidation level was respected or entry was extended.");
    } else if (play.closedReason === "thesis") {
      lines.push("Thesis break exit — pillar degradation was the signal; review which pillar failed first.");
    }
  }
  if (play.archetype) {
    lines.push(`Archetype **${play.archetype.replace(/_/g, " ")}** — tag this outcome in your playbook review.`);
  }
  if (play.execPnlPct != null && play.exitPnlPct != null && Math.abs(play.execPnlPct - play.exitPnlPct) > 5) {
    lines.push(
      `Executable vs mid exit: **${fmtPct(play.execPnlPct)}** vs **${fmtPct(play.exitPnlPct)}** — slippage on the tape.`,
    );
  }
  if (!lines.length) return null;
  return { title: "Lessons", body: lines.join("\n") };
}

function formatMeridianItem(i: LargoTimelineItem): string {
  const when =
    i.days_until <= 0
      ? "**today**"
      : i.days_until === 1
        ? "**tomorrow**"
        : `in **${i.days_until}d**`;
  const em = i.expected_move_pct != null ? ` · implied move **${i.expected_move_pct.toFixed(1)}%**` : "";
  const printed = i.is_printed ? " · **printed**" : "";
  const timing = i.time ? ` @ ${i.time}` : "";
  return `• **${i.title}** (${i.kind}, ${i.impact}) — ${i.date}${timing} ${when}${em}${printed}`;
}

/** Meridian desk catalyst calendar — richer than UW earnings stub alone. */
export function meridianCatalystSection(ctx: SwingPlayBriefContext): RichSection | null {
  const slice = ctx.meridian;
  if (slice?.unavailable) {
    return {
      title: "Meridian catalysts",
      body: "Catalyst calendar unavailable on this read — not evidence of a quiet calendar.",
    };
  }
  if (!slice?.items.length) return null;

  const lines = slice.items.map(formatMeridianItem);
  if (slice.total_matched > slice.items.length) {
    lines.push(
      `_${slice.total_matched - slice.items.length} more in window — open Meridian desk for full lane._`,
    );
  }
  return { title: "Meridian catalysts", body: lines.join("\n") };
}

/** Macro rates + market breadth when arsenal fetched index context. */
export function macroTapeSection(eco: EcosystemContext | null): RichSection | null {
  const arsenal = eco?.arsenal;
  if (!arsenal) return null;
  const lines: string[] = [];
  if (arsenal.macro) {
    const m = arsenal.macro;
    const parts: string[] = [];
    if (m.yield_10_year != null) parts.push(`10Y **${m.yield_10_year.toFixed(2)}%**`);
    if (m.curve_10y_1y_spread != null) parts.push(`10s-1s **${m.curve_10y_1y_spread.toFixed(2)}**`);
    if (m.cpi != null) parts.push(`CPI **${m.cpi.toFixed(1)}**`);
    if (parts.length) lines.push(`Rates backdrop: ${parts.join(" · ")}`);
  }
  if (arsenal.breadth) {
    lines.push(`Market breadth: **${arsenal.breadth.tone}** — ${arsenal.breadth.summary}`);
  }
  if (!lines.length) return null;
  return { title: "Macro tape", body: lines.join("\n\n") };
}

/**
 * Supplementary desk context not already narrated in Trade manager read.
 * NH/0DTE direction + friction live in `crossDeskCoaching` — avoid duplicating raw dumps here.
 */
export function deskConsensusSection(eco: EcosystemContext | null, play: TerminalPlay): RichSection | null {
  if (!eco) return null;
  const lines: string[] = [];

  const nh = eco.nighthawk_recent;
  if (nh?.outcome && nh.edition_for) {
    lines.push(
      `Night Hawk's last swing on this name (**${nh.edition_for}**) closed **${nh.outcome}** — weigh that track record against today's **${play.direction}** setup before sizing.`,
    );
  }

  const anomaly = eco.recent_anomalies?.[0];
  if (anomaly) {
    lines.push(
      `Flow desk flagged **${anomaly.anomaly_type}** — ${anomaly.detail}. Confirm it still supports your thesis or treat it as a veto.`,
    );
  }

  if (!lines.length) return null;
  return { title: "Desk context", body: lines.join("\n\n") };
}

/** GEX dealer posture — gamma/vanna context for the swing. */
export function gexPostureSection(ctx: SwingPlayBriefContext): RichSection | null {
  const gex = ctx.ecosystem?.gex_positioning;
  if (!gex) return null;
  const lines: string[] = [];
  if (gex.gamma_posture) {
    const posture =
      gex.gamma_posture === "long"
        ? "dealers **long gamma** — dips tend to get bought, range/pin behavior"
        : "dealers **short gamma** — moves can accelerate, respect walls";
    lines.push(`Gamma posture: ${posture}`);
  }
  if (gex.net_gex != null) lines.push(`Net GEX: **${(gex.net_gex / 1_000_000).toFixed(1)}M**`);
  if (gex.nearest_wall != null && gex.spot != null) {
    const { strike, kind, distance_pts } = gex.nearest_wall;
    lines.push(
      `Nearest wall: **${strike.toFixed(2)}** (${kind}, ${distance_pts.toFixed(1)} pts from spot **${gex.spot.toFixed(2)}**)`,
    );
  }
  if (gex.change_pct != null) lines.push(`Underlying session: **${fmtPct(gex.change_pct)}**`);
  if (!lines.length) return null;
  return { title: "GEX posture", body: lines.join("\n") };
}

/** Wall bead dynamics — building/fading nodes from Vector wall history. */
export function wallDynamicsSection(vec: VectorFullState | null): RichSection | null {
  const events = vec?.wallEvents ?? [];
  if (!events.length) return null;
  const lines = events
    .slice(0, 5)
    .map((e) => {
      const at = e.strike != null ? ` @ ${e.strike.toFixed(2)}` : e.flip != null ? ` @ flip ${e.flip.toFixed(2)}` : "";
      return `• **${e.kind.replace(/_/g, " ")}**${at} — ${e.message}`;
    })
    .join("\n");
  return { title: "Wall dynamics", body: lines };
}

/** Vector desk play read — entry zone, targets, invalidation from play engine. */
export function vectorDeskSection(vec: VectorFullState | null): RichSection | null {
  const p = vec?.play;
  if (!p) return null;
  const lines: string[] = [];
  lines.push(`**${p.headline}** · grade **${p.grade}** · conviction **${p.conviction}**`);
  if (p.thesis) lines.push(p.thesis);
  if (p.entryZone) lines.push(`Entry zone: **${p.entryZone}**`);
  if (p.targets.length) lines.push(`Targets: ${p.targets.map((t) => `**${t}**`).join(" · ")}`);
  if (p.invalidation) lines.push(`Invalidation: **${p.invalidation}**`);
  if (p.starred.length) {
    lines.push("**Watch now:**\n" + p.starred.slice(0, 4).map((s) => `• ${s}`).join("\n"));
  }
  return { title: "Vector desk", body: lines.join("\n\n"), bias: p.bias === "short" ? "bearish" : p.bias === "long" ? "bullish" : "neutral" };
}

/** Honest data freshness — mark age, scan age, vector staleness. */
export function dataFreshnessSection(ctx: SwingPlayBriefContext): RichSection | null {
  const { play, scanAsOf, vector: vec } = ctx;
  const lines: string[] = [];
  if (play.markAsOf) {
    lines.push(`Option mark as of **${play.markAsOf}**`);
  } else if (play.markIsSync) {
    lines.push("**Mark age unknown** — sync quote without timestamp; treat P&L as indicative");
  }
  if (scanAsOf) lines.push(`Swing scan: **${scanAsOf}**`);
  if (vec?.dataAgeMs != null && vec.dataAgeMs > 120_000) {
    lines.push(`Vector data **${Math.round(vec.dataAgeMs / 1000)}s** old — levels may lag live spot`);
  }
  if (!lines.length) return null;
  return { title: "Data freshness", body: lines.join("\n"), bias: play.markIsSync ? "bearish" : "neutral" };
}

/** Build all intelligence sections for the current play state. */
export function buildIntelSections(
  ctx: SwingPlayBriefContext,
  bucket: "watch" | "open" | "closed",
): RichSection[] {
  const { play, ecosystem } = ctx;
  const vec = vectorOf(ctx);
  const out: RichSection[] = [];

  const narrative = tradeManagerNarrativeSection(ctx, bucket);
  if (narrative) out.push(narrative);

  out.push(whyThisSetupSection(play));

  const book = bookContextSection(play, ctx.openBook);
  if (book) out.push(book);

  const rank = laneRankSection(play, ctx.laneRows);
  if (rank) out.push(rank);

  const technicals = chartTechnicalsSection(vec, play);
  if (technicals) out.push(technicals);

  const levels = chartLevelsSection(ctx);
  if (levels) out.push(levels);

  const gex = gexPostureSection(ctx);
  if (gex) out.push(gex);

  const walls = wallDynamicsSection(vec);
  if (walls) out.push(walls);

  const vdesk = vectorDeskSection(vec);
  if (vdesk) out.push(vdesk);

  const flow = flowIntelSection(ecosystem, play);
  if (flow) out.push(flow);

  const catalysts = catalystsSection(ecosystem);
  if (catalysts) out.push(catalysts);

  const meridian = meridianCatalystSection(ctx);
  if (meridian) out.push(meridian);

  const macro = macroTapeSection(ecosystem);
  if (macro) out.push(macro);

  const consensus = deskConsensusSection(ecosystem, play);
  if (consensus) out.push(consensus);

  const fresh = dataFreshnessSection(ctx);
  if (fresh) out.push(fresh);

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
