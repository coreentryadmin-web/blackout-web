/**
 * Swing Play Intelligence — rich deterministic sections.
 * Surfaces chart technicals, flow, GEX nodes, catalysts, watch levels, and hold plan.
 */
import type { RichSection } from "@/lib/bie/rich-narrative";
import { fmtPremium } from "@/lib/fmt-money";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import {
  playExpectsLiveOptionMark,
  gexMatrixAgeMs,
  gexMatrixStale,
  GEX_MATRIX_STALE_MS,
  vectorSnapshotStale,
} from "./play-brief-absence";
import type { SwingPlayBriefContext } from "./play-brief-types";
import type { LargoTimelineItem } from "@/lib/largo/meridian-timeline-for-largo";
import { laneRankSection } from "./play-brief-lane-rank";
import { tradeManagerNarrativeSection } from "./play-brief-narrative";
import { technicalsBias } from "./play-brief-technicals";
import type { VectorFullState } from "@/lib/bie/vector-full-state";
import type { EcosystemContext } from "@/lib/bie/ecosystem-context";
import type { ConfluenceZone } from "@/features/vector/lib/vector-confluence";
import { checkPortfolioOverlap, type PortfolioPosition } from "./portfolio";
import { parseSwingPlayId } from "./play-brief-resolve-pure";
import { trustedHelixFlow, zerodteLiveForSession } from "./play-brief-absence";
import { mfeCaptureOutcome } from "./mfe-capture";
import { collapseRedundantIntelSections } from "./play-brief-intel-collapse";
import { etStampFromIso } from "@/lib/largo/temporal/bar-session-date";
import { thesisHealthUncalibrated } from "./thesis-health";
import { ARCHETYPE_META, SWING_ARCHETYPES } from "./taxonomy";
import { graduatedArchetypeEntry, type SwingArchetypeTrackRecordSnapshot } from "./calibration-cache";
import {
  meridianPeerEarningsCoaching,
  pickEarningsForSwingPeer,
} from "./play-brief-meridian-peer-core";

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
  if (play.subLane) lines.push(`**Sub-lane:** ${play.subLane.replace(/_/g, " ")}`);
  if (play.regime) lines.push(`**Discovery read:** ${play.regime}`);
  if (play.sectorLeadershipFacts) {
    const f = play.sectorLeadershipFacts;
    const verb = f.deltaPct >= 0 ? "leading" : "lagging";
    lines.push(
      `**Industry read:** ${verb} **${f.benchmarkLabel}** (${f.benchmarkEtf}) by ${Math.abs(f.deltaPct).toFixed(1)}% ` +
        `over 10 sessions (${fmtPct(f.nameReturnPct)} vs ${fmtPct(f.groupReturnPct)}).`,
    );
  }
  // recNote is NOT repeated here — Management (open bucket, play-brief.ts) and Verdict (watch
  // bucket) already render it verbatim. Duplicating it produced the same sentence twice in one
  // brief (FINDINGS 2026-09-06, live NRG SWING_NRG_34) and crowded out this section's actual job:
  // the pillar/signal breakdown behind the grade.

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
export function bookContextSection(
  play: TerminalPlay,
  openBook: PortfolioPosition[] | null | undefined,
): RichSection | null {
  if (openBook == null || !openBook.length) return null;
  const { positionId } = parseSwingPlayId(play.id);
  const overlap = checkPortfolioOverlap(
    { ticker: play.ticker, direction: play.direction },
    openBook,
    positionId != null ? { excludePositionId: positionId } : undefined,
  );
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

/**
 * Track record — cites the ticker's OWN archetype's historical graduation evidence (Largo product
 * contract C10, "historical context"; calibration-cache.ts's distilled snapshot the swing-
 * active-refresh cron writes every tick). Renders ONLY when the archetype bucket has actually
 * GRADUATED (`graduated:true` — LIMITED/BROAD tier, Wilson-LB gate, point-Δ≥15pt all cleared); an
 * ungraduated bucket is OMITTED rather than shown caveated, per the contract's confidence-omission
 * principle (C6: "if a product cannot produce a calibrated score, OMIT the field... an invented
 * score is worse than nothing"). A play with an unclassified/foreign archetype, or a cold/timed-out
 * cache read (ctx.archetypeTrackRecord null/undefined), also renders nothing — same honest absence,
 * not an error.
 *
 * Scoped to the ARCHETYPE dimension only for this section (sub-lane graduation is distilled and
 * cached alongside it — calibration-cache.ts's `snapshot.subLanes` — but combining two graduated
 * dimensions into one citation without double-counting evidence or cluttering the brief is left as
 * a follow-up; shipping the archetype citation alone is the smaller, correct slice per the standing
 * "ship less but correct" guidance).
 */
export function archetypeTrackRecordSection(
  play: TerminalPlay,
  snapshot: SwingArchetypeTrackRecordSnapshot | null | undefined,
): RichSection | null {
  const archetype = (SWING_ARCHETYPES as readonly string[]).includes(play.archetype ?? "")
    ? (play.archetype as (typeof SWING_ARCHETYPES)[number])
    : null;
  const entry = graduatedArchetypeEntry(snapshot, archetype);
  if (!entry || !archetype) return null;

  const label = ARCHETYPE_META[archetype].label;
  const sampleNote = entry.tier === "BROAD" ? "broad sample" : "limited sample — still evidence, not vibes";
  const lines: string[] = [
    `**${label}** — ${entry.wins}W / ${entry.losses}L across **${entry.n}** graded plays (${sampleNote}).`,
    `Raw win rate **${entry.winRatePct != null ? `${entry.winRatePct.toFixed(0)}%` : "—"}** · Wilson 95% lower bound **${entry.wilsonLbPct.toFixed(0)}%** — the conservative floor this evidence actually supports, not the point estimate.`,
  ];
  if (entry.pointDeltaPts != null) {
    lines.push(
      `Clears this archetype's provisional score floor by **+${entry.pointDeltaPts.toFixed(0)} pts** win-rate edge vs setups that did not.`,
    );
  }
  return { title: "Track record", body: lines.join("\n\n"), bias: "neutral" };
}

/**
 * Cortex read — surfaces WHY the evidence layer opposed/vetoed this position at commit
 * (`entry_context.cortex`, pinned by swing `commit.ts` the same way 0DTE pins it and already
 * readable there via `bie/cortex-read.ts`'s `readCortexForPlay()` — swing had no equivalent
 * until this section). Renders ONLY when there is an actual signal to report: a real,
 * non-abstained verdict carrying at least one veto or opposing item. A clean commit (no
 * vetoes/opposes), an abstained read, or no pinned verdict at all (pre-wire-in row, WATCH/
 * lane-only candidate) all render NOTHING — never a fabricated "Cortex is fine" line, per
 * the Largo product-contract absence principle (omit an uncalibrated/absent read, don't guess).
 * Prefers the pinned `narrative` lines (the same ready-made human-readable strings the
 * verdict composer writes) and falls back to a constructed summary only if narrative is empty.
 */
export function cortexReadSection(play: TerminalPlay): RichSection | null {
  const view = play.cortex;
  if (!view || view.abstained) return null;
  const v = view.verdict;
  const vetoCount = v.vetoes?.length ?? 0;
  const opposeCount = v.opposes?.length ?? 0;
  if (vetoCount === 0 && opposeCount === 0) return null; // clean/supportive read — nothing to flag

  const header = `Cortex ${view.decision ?? "read"} at commit — net score ${v.score >= 0 ? "+" : ""}${v.score}, conviction ${v.conviction}, ${vetoCount} veto${vetoCount === 1 ? "" : "es"} · ${opposeCount} opposing item${opposeCount === 1 ? "" : "s"}.`;
  const narrativeLines = Array.isArray(v.narrative) ? v.narrative.filter((l) => typeof l === "string" && l.trim()) : [];
  const evidenceLines =
    narrativeLines.length > 0
      ? narrativeLines
      : [
          ...v.vetoes.map((e) => `VETO — [${e.source}] ${e.detail}`),
          ...v.opposes.map((e) => `Opposed — [${e.source}] ${e.detail}`),
        ];

  return {
    title: "Cortex read",
    body: [header, ...evidenceLines].join("\n\n"),
    bias: vetoCount > 0 || v.score < 0 ? "bearish" : "neutral",
  };
}

/** Vector chart technicals — EMA stack, VWAP, RSI, MACD, structure. */
export function chartTechnicalsSection(
  vec: VectorFullState | null,
  sessionDate?: string | null,
): RichSection | null {
  if (!vec?.technicals && vec?.spot == null) return null;
  const readMs = Date.now();
  const vectorStale = vectorSnapshotStale(vec, readMs, sessionDate);
  const t = vec.technicals;
  const lines: string[] = [];
  if (vectorStale) {
    const ageMs = vec?.dataAgeMs;
    lines.push(
      `**Last snapshot**${ageMs != null ? ` (~${Math.round(ageMs / 1000)}s old)` : ""} — chart read may lag spot.`,
    );
    if (vec.play?.grade) lines.push(`Vector desk grade: **${vec.play.grade}** (from prior snapshot)`);
    if (!lines.length) return null;
    return { title: "Chart technicals", body: lines.join("\n"), bias: "neutral" };
  }
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
  // "Vector regime" is a DEALER GAMMA posture (long-gamma/short-gamma), not a directional call —
  // labeling it bare "long"/"short" next to directional signals (EMA stack, MACD, structure
  // direction) in this same section risks reading as a trade direction that can contradict the
  // very next "Vector desk" section's own directional POSITION call for the same ticker.
  if (vec.regime?.posture && vec.regime.posture !== "unknown" && vec.regime.posture !== "transition") {
    lines.push(`Dealer gamma regime: **${vec.regime.posture} gamma**`);
  } else if (vec.regime?.posture === "transition") {
    lines.push(`Dealer gamma regime: **transition** (near flip)`);
  }
  if (vec.play?.grade) lines.push(`Vector desk grade: **${vec.play.grade}**`);
  if (!lines.length) return null;
  const bias = t ? technicalsBias(t, vec.spot ?? null) : "neutral";
  return {
    title: "Chart technicals",
    body: lines.join("\n"),
    bias,
  };
}

function formatConfluenceZone(z: ConfluenceZone, spot: number | null): string {
  const kinds = z.kinds.join("+");
  const dist = spot != null ? ` · ${fmtDist(spot, z.center)}` : "";
  return `• **${z.center.toFixed(2)}** (${kinds}, score ${z.score.toFixed(1)})${dist}`;
}

/** GEX walls, flip, max pain, expected move, confluence nodes. */
export function chartLevelsSection(ctx: SwingPlayBriefContext): RichSection | null {
  const vec = vectorOf(ctx);
  const eco = ctx.ecosystem;
  const gex = eco?.gex_positioning;
  const readMs = Date.now();
  const vectorStaleForLevels = vectorSnapshotStale(vec, readMs, ctx.sessionDate);
  const gexStaleForLevels = gexMatrixStale(gex, readMs);
  const spot =
    (vectorStaleForLevels ? undefined : vec?.spot) ??
    (gexStaleForLevels ? undefined : gex?.spot) ??
    null;
  const lines: string[] = [];

  const vecCallWall = vectorStaleForLevels ? undefined : vec?.gexWalls?.callWalls?.[0]?.strike;
  const vecPutWall = vectorStaleForLevels ? undefined : vec?.gexWalls?.putWalls?.[0]?.strike;
  const vecFlip = vectorStaleForLevels ? undefined : vec?.gammaFlip;
  const callWall = vecCallWall ?? gex?.call_wall ?? null;
  const putWall = vecPutWall ?? gex?.put_wall ?? null;
  const flip = vecFlip ?? gex?.flip ?? null;
  const callWallFromStaleGex = vecCallWall == null && gex?.call_wall != null && gexStaleForLevels;
  const putWallFromStaleGex = vecPutWall == null && gex?.put_wall != null && gexStaleForLevels;
  const flipFromStaleGex = vecFlip == null && gex?.flip != null && gexStaleForLevels;
  // King strike previously read GEX-only here ("Vector presence irrelevant") while play-brief.ts's
  // structured `levels` array AND play-brief-narrative.ts's focalLevelsFrom (used by the "Trade
  // manager read" section) both already preferred a live Vector-ladder king via
  // `vec?.ladder?.rows?.find(isKing) ?? gex.gex_king_strike`. Same envelope, same conceptual level,
  // two different precedence rules — a member could see e.g. "GEX king strike: 330.00" here (raw
  // GEX matrix) and "GEX king 320.00" in the structured Key levels / Trade manager read for the
  // SAME brief (live-confirmed 2026-09-09, AAPL:36: matrix gex_king_strike=330 vs Vector ladder
  // king=320, both rendered in the same envelope). Match the other two call sites' precedence so
  // every section in one brief tells the same GEX-king story (Largo contract: one coherent read).
  const vecKingForLevels = vectorStaleForLevels ? undefined : vec?.ladder?.rows?.find((r) => r.isKing)?.strike;
  const king = vecKingForLevels ?? gex?.gex_king_strike ?? null;
  const kingFromStaleGex = vecKingForLevels == null && gex?.gex_king_strike != null && gexStaleForLevels;

  if (callWall != null && !callWallFromStaleGex) {
    lines.push(`**Call wall (GEX):** ${callWall.toFixed(2)}${spot != null ? ` — ${fmtDist(spot, callWall)}` : ""}`);
  }
  if (putWall != null && !putWallFromStaleGex) {
    lines.push(`**Put wall (GEX):** ${putWall.toFixed(2)}${spot != null ? ` — ${fmtDist(spot, putWall)}` : ""}`);
  }
  if (flip != null && !flipFromStaleGex) {
    lines.push(`**Gamma flip:** ${flip.toFixed(2)}${spot != null ? ` — ${fmtDist(spot, flip)}` : ""}`);
  }
  if (king != null && !kingFromStaleGex) {
    lines.push(`GEX king strike: **${king.toFixed(2)}**`);
  }
  if (vec?.maxPain != null && !vectorStaleForLevels) {
    lines.push(`Max pain: **${vec.maxPain.toFixed(2)}**`);
  }
  if (vec?.expectedMove?.bands?.length && !vectorStaleForLevels) {
    const bandStr = vec.expectedMove.bands
      .slice(0, 2)
      .map((b) => `${b.sigma}σ ${b.low.toFixed(2)}–${b.high.toFixed(2)}`)
      .join(" · ");
    lines.push(`Expected move: **${bandStr}**`);
  }
  if (vec?.proximity?.strike != null && !vectorStaleForLevels) {
    lines.push(
      `Nearest wall: **${vec.proximity.strike.toFixed(2)}** (${vec.proximity.side}, ${vec.proximity.distancePct.toFixed(1)}% away) — ${vec.proximity.callout}`,
    );
  }
  const zones = vec?.confluenceZones ?? [];
  if (zones.length && !vectorStaleForLevels) {
    const top = [...zones].sort((a, b) => b.score - a.score).slice(0, 4);
    lines.push("**Confluence nodes:**\n" + top.map((z) => formatConfluenceZone(z, spot)).join("\n"));
  }
  const dp = vec?.darkPoolLevels ?? [];
  if (dp.length && !vectorStaleForLevels) {
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
export function flowIntelSection(
  eco: EcosystemContext | null,
  play: TerminalPlay,
  sessionDate?: string | null,
): RichSection | null {
  if (!eco) return null;
  const lines: string[] = [];

  const flow = trustedHelixFlow(eco);
  if (flow) {
    const f = flow;
    const bias =
      f.call_premium > f.put_premium * 1.3
        ? "call-heavy"
        : f.put_premium > f.call_premium * 1.3
          ? "put-heavy"
          : "balanced";
    lines.push(
      `HELIX tape (${f.window_hours}h): **${bias}** — calls ${fmtPremium(f.call_premium)} · puts ${fmtPremium(f.put_premium)} · ${f.print_count} prints`,
    );
  }

  const helixFresh = eco.flow_feed_fresh !== false;

  if (helixFresh && eco.recent_anomalies?.length) {
    const anomalies = eco.recent_anomalies
      .slice(0, 4)
      .map((a) => `• **${a.anomaly_type}** — ${a.detail}${a.direction ? ` (${a.direction})` : ""}`)
      .join("\n");
    lines.push("**Flow anomalies:**\n" + anomalies);
  }

  const recent = helixFresh ? (eco.flow_full_state?.recent ?? []) : [];
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

  const z = zerodteLiveForSession(eco.zerodte_today, sessionDate);
  if (z) {
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
  const readMs = Date.now();
  const vectorStale = vectorSnapshotStale(vec, readMs, ctx.sessionDate);
  const gexForSpot = ctx.ecosystem?.gex_positioning;
  const gexStaleForSpot = gexMatrixStale(gexForSpot, readMs);
  const spot =
    (vectorStale ? undefined : vec?.spot) ??
    (gexStaleForSpot ? undefined : gexForSpot?.spot) ??
    null;
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

  // The `Thesis **...**` note is a LIVE, ticker-keyed read of whether Night Hawk currently sees an
  // active setup on this name (serving-ingest.ts `thesisLevel`/`thesisNote`) — it is NOT the thesis
  // of the specific CLOSED position being reviewed here, which already resolved. Printed against a
  // closed play it reads as if the (already-decided) trade's thesis were still open, which is a
  // contract violation (identity/direction: whose thesis, and is it live) — so it's closed-bucket-
  // only suppressed; watch/open plays are still evaluating entry, where "is there a live setup here
  // right now" is exactly the right question.
  if (bucket !== "closed" && (play.thesisBreak?.note || play.thesisBreak?.level)) {
    lines.push(
      `Thesis **${play.thesisBreak.level ?? "unknown"}**${play.thesisBreak.note ? ` — ${play.thesisBreak.note}` : ""}`,
    );
  }

  const gexForLevels = ctx.ecosystem?.gex_positioning;
  const vectorStaleForWalls = vectorStale;
  const vecFlip = vectorStaleForWalls ? undefined : vec?.gammaFlip;
  const flip = vecFlip ?? gexForLevels?.flip;
  const flipFromStaleGex = vecFlip == null && gexForLevels?.flip != null && gexMatrixStale(gexForLevels, readMs);
  if (flip != null && spot != null && !flipFromStaleGex) {
    // Closed plays get NEUTRAL, informational framing ("trades at X vs flip Y") rather than the
    // "reclaim/lose ... invalidates thesis" imperative used for watch/open — that phrasing reads as
    // guidance on a still-live position, but a CLOSED play has no thesis left to invalidate.
    const watch =
      bucket === "closed"
        ? `Now trades **${spot.toFixed(2)}** vs gamma flip **${flip.toFixed(2)}** — where the dealer regime sits since this play closed`
        : play.direction === "LONG"
          ? `Lose gamma flip **${flip.toFixed(2)}** — dealer posture turns against longs`
          : `Reclaim gamma flip **${flip.toFixed(2)}** — invalidates short thesis`;
    lines.push(watch);
  }

  const vecPutWall = vectorStaleForWalls ? undefined : vec?.gexWalls?.putWalls?.[0]?.strike;
  const vecCallWall = vectorStaleForWalls ? undefined : vec?.gexWalls?.callWalls?.[0]?.strike;
  const putWall = vecPutWall ?? gexForLevels?.put_wall;
  const callWall = vecCallWall ?? gexForLevels?.call_wall;
  const gexStaleForLevels = gexMatrixStale(gexForLevels, readMs);
  const putWallFromStaleGex = vecPutWall == null && gexForLevels?.put_wall != null && gexStaleForLevels;
  const callWallFromStaleGex = vecCallWall == null && gexForLevels?.call_wall != null && gexStaleForLevels;
  if (play.direction === "LONG" && putWall != null && !putWallFromStaleGex) {
    lines.push(`Structural support node: put wall **${putWall.toFixed(2)}**`);
  }
  if (play.direction === "SHORT" && callWall != null && !callWallFromStaleGex) {
    lines.push(`Structural resistance node: call wall **${callWall.toFixed(2)}**`);
  }

  if (bucket === "open" && play.exitPolicy?.stop_premium != null) {
    const stop = play.exitPolicy.stop_premium;
    // Cushion = how far (%) the current mark could still fall before hitting the stop — the
    // dollar level alone forces a member to do that subtraction themselves. Only shown when the
    // mark is actually above the stop (the normal case for an OPEN row); omitted rather than
    // shown negative/zero when data is missing or mid a stale-mark edge case — never fabricated.
    const cushionPct =
      play.mark != null && play.mark > 0 && play.mark > stop ? ((play.mark - stop) / play.mark) * 100 : null;
    const cushionNote = cushionPct != null ? ` — ${cushionPct.toFixed(0)}% cushion from current mark` : "";
    lines.push(
      `Premium stop rail: **${fmtUsd(stop)}**${cushionNote} — thesis breaks if mark closes below`,
    );
  }

  if (!lines.length) {
    lines.push(
      bucket === "closed"
        ? "No gamma flip / GEX wall read available for this name since the play closed."
        : "Watch spot vs gamma flip and nearest GEX wall — no extra triggers wired on this row.",
    );
  }

  return {
    title: bucket === "open" ? "What to watch" : bucket === "closed" ? "Since it closed" : "Watch levels",
    body: lines.join("\n\n"),
    bias: bucket === "closed" ? "neutral" : play.thesisBreak?.level === "break" ? "bearish" : "neutral",
  };
}

/** Hold plan — time/theta, earnings risk, session stops, thesis-health coaching for open rows. */
export function holdPlanSection(ctx: SwingPlayBriefContext): RichSection | null {
  const { play } = ctx;
  if (statusBucket(play) !== "open") return null;

  const lines: string[] = [];
  // recNote, desk stance, trim ladder, rails, and manageAction live in Management (play-brief.ts)
  // — do not repeat them here (same duplication class as whyThisSetupSection, FINDINGS 2026-09-06).

  const dteMatch = play.contract.match(/(\d+)DTE/);
  if (dteMatch) {
    const dte = Number(dteMatch[1]);
    lines.push(`Contract runway: **${dte} DTE** — theta accelerates inside ~7 DTE`);
  }

  // Near-term-earnings warning is NOT repeated here — catalystCoaching (play-brief-narrative-
  // coaching.ts) already renders the same "Earnings in Nd (DATE) — size down or exit before
  // report..." sentence into "Trade manager read" for every WATCH/OPEN play within 14 days of a
  // known earnings date, and both sections render together for any live OPEN play. Same
  // duplication class as the thesis-health advisory and recNote/rails fixes above (#4261,
  // 2026-09-06) — found during the 2026-09-11 Ask Largo catalysts-timing pass.

  if (play.exitPolicy) {
    const ep = play.exitPolicy;
    if (ep.time_stop_et) lines.push(`Session time stop: **${ep.time_stop_et} ET**`);
    if (ep.runner_fraction != null) {
      lines.push(`Runner: **${Math.round(ep.runner_fraction * 100)}%** of position after trims`);
    }
  }

  if (play.thesisHealth) {
    const h = play.thesisHealth;
    const uncalibrated = thesisHealthUncalibrated(h);
    if (!uncalibrated) {
      // advisory is NOT repeated here — it's the exact sentence tradeManagerNarrativeSection's
      // pillar-fade narration already carries in "Trade manager read" (both render for any live
      // play). Health%/rung is a compact number, not a repeated sentence, so it stays.
      lines.push(`Thesis health **${h.health}%** (${h.rungLabel})`);
      if (h.health < 45) lines.push("**Tighten risk** — thesis fading; don't add size");
    }
    // Peak giveback is grounded in committed trade marks — independent of thesis-health calibration.
    // Honest RELATIVE retracement via mfe-capture.ts, not a percentage-POINT subtraction of two
    // already-percentage numbers (same fix as the two sibling call sites, FINDINGS 2026-09-10).
    // captureFloor=70 is the LEAST sensitive of the three call sites — this bullet only renders
    // when thesisHealth is already present (a live open play with a computed thesis read already
    // surfaced above), so a smaller giveback is less likely to be worth a second callout here.
    const giveback = mfeCaptureOutcome(play.pnlPct, play.peak, null);
    if (giveback?.kind === "round_trip") {
      // NOT "consider trim into strength" — the play has already round-tripped PAST breakeven
      // into a loss, so there is no strength left to trim into; that phrasing was the exact
      // self-contradiction fixed in actionNarrative's TRIM branch (FINDINGS 2026-09-10,
      // "trim-strength-line-vs-round-trip") — this call site independently computes the same
      // giveback and was missed by that fix's blast-radius check. Matches the wording
      // play-brief-narrative.ts's SELL branch already uses for the identical fact.
      lines.push(
        `**Round-tripped past breakeven** — was up **${giveback.peakPct.toFixed(0)}%** at peak, now **${giveback.exitPnlPct.toFixed(0)}%** — consider protecting what's left`,
      );
    } else if (giveback?.kind === "capture" && giveback.capturePct < 70) {
      lines.push(`Gave back **${(100 - giveback.capturePct).toFixed(0)}%** from peak — consider trim into strength`);
    }
  }

  if (!lines.length) return null;

  return { title: "Hold plan", body: lines.join("\n\n") };
}

/** Post-mortem for closed plays — MFE capture + archetype learning loop.
 *  `roundTripAlreadyNoted` — closedCoaching (play-brief-narrative-coaching.ts, feeds the "Trade
 *  manager read" section built earlier in buildIntelSections) independently derives the identical
 *  round-trip-past-breakeven fact from the same peak/exitPnlPct inputs via the same
 *  mfeCaptureOutcome() call, and states it first. Same restatement class as the "thesis health"
 *  advisory two sections up in this file — see that comment. */
export function lessonsSection(play: TerminalPlay, roundTripAlreadyNoted?: boolean): RichSection | null {
  if (play.status !== "CLOSED") return null;
  const lines: string[] = [];
  if (play.peak != null && play.exitPnlPct != null) {
    const outcome = mfeCaptureOutcome(play.exitPnlPct, play.peak, play.mfeCapturePct);
    lines.push(`Peak was **${fmtPct(play.peak)}** · exited **${fmtPct(play.exitPnlPct)}**`);
    if (outcome?.kind === "round_trip") {
      if (!roundTripAlreadyNoted) {
        lines.push(`**Round-tripped past breakeven** — up **${fmtPct(outcome.peakPct)}** at peak, closed at **${fmtPct(outcome.exitPnlPct)}**.`);
      }
      lines.push("**Gave back the move** — next time tighten at first trim rail or thesis fade.");
    } else if (outcome?.kind === "capture") {
      const capture = outcome.capturePct;
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
  if (!slice?.items.length) {
    return {
      title: "Meridian catalysts",
      body:
        "No catalysts in the **14-day** Meridian window on this read — calendar is quiet, not missing.",
    };
  }

  const lines = slice.items.map(formatMeridianItem);
  if (slice.total_matched > slice.items.length) {
    lines.push(
      `_${slice.total_matched - slice.items.length} more in window — open Meridian desk for full lane._`,
    );
  }
  return { title: "Meridian catalysts", body: lines.join("\n") };
}

/**
 * Meridian peer earnings cohort — sector beat-rate context for the name's print.
 * Lives as its own section so MAX_BULLETS narrative cap cannot drop peer history.
 */
export function meridianPeerSection(ctx: SwingPlayBriefContext): RichSection | null {
  const earningsItem = pickEarningsForSwingPeer(ctx.meridian?.items, ctx.play.ticker);
  const body = meridianPeerEarningsCoaching(ctx.meridianPeer, earningsItem);
  if (!body) return null;
  return { title: "Earnings peer lens", body };
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
 * NH/0DTE direction + friction live in `crossDeskCoaching`; flow anomalies live in
 * `flowNarrative` (Trade manager read) and `flowIntelSection` — only NH outcome history
 * belongs here so members never see the same sweep twice.
 */
export function deskConsensusSection(
  eco: EcosystemContext | null,
  play: TerminalPlay,
  bucket: "watch" | "open" | "closed" = "open",
): RichSection | null {
  if (!eco) return null;

  const nh = eco.nighthawk_recent;
  if (!nh?.outcome || !nh.edition_for) return null;

  // `outcome` is "target" | "stop" | "open" | "ambiguous" | "pending" | "unfilled"
  // (nighthawk/lib/play-outcomes.ts) — "open"/"pending" mean the swing hasn't resolved
  // yet, so hardcoding "closed" produced a live contradiction ("closed open").
  const unresolved = nh.outcome === "open" || nh.outcome === "pending";
  const verdict = unresolved ? "is still **unresolved**" : `closed **${nh.outcome}**`;

  // Same defect class as watchForSection/vectorDeskSection (#4570/#4571): a CLOSED play has no
  // sizing decision left to make, so "today's setup ... before sizing" reads as live guidance on
  // a trade that already resolved. Reframe as a retrospective note instead of dropping the
  // section — the NH outcome-history fact itself is still useful context for reviewing the trade.
  const tail =
    bucket === "closed"
      ? `— for reference against the **${play.direction}** setup this play traded.`
      : `— weigh that track record against today's **${play.direction}** setup before sizing.`;

  return {
    title: "Desk context",
    body: `Night Hawk's last swing on this name (**${nh.edition_for}**) ${verdict} ${tail}`,
  };
}

/** GEX dealer posture — gamma/vanna context for the swing. */
export function gexPostureSection(ctx: SwingPlayBriefContext): RichSection | null {
  const gex = ctx.ecosystem?.gex_positioning;
  if (!gex) return null;
  const readMs = Date.now();
  const stale = gexMatrixStale(gex, readMs);
  const ageMs = stale ? gexMatrixAgeMs(gex, readMs) : null;
  const lines: string[] = [];
  if (stale) {
    lines.push(
      `**Last snapshot**${ageMs != null ? ` (~${Math.round(ageMs / 1000)}s old)` : ""} — dealer posture may lag spot.`,
    );
  }
  // Suppress GEX-only posture when matrix is stale — same Largo C2 class as chartLevels/watchFor/king (#4372/#4375).
  if (gex.gamma_posture && !stale) {
    const posture =
      gex.gamma_posture === "long"
        ? "dealers **long gamma** — dips tend to get bought, range/pin behavior"
        : "dealers **short gamma** — moves can accelerate, respect walls";
    lines.push(`Gamma posture: ${posture}`);
  }
  if (!stale && gex.net_gex != null) lines.push(`Net GEX: **${(gex.net_gex / 1_000_000).toFixed(1)}M**`);
  if (!stale && gex.nearest_wall != null && gex.spot != null) {
    const { strike, kind, distance_pts } = gex.nearest_wall;
    lines.push(
      `Nearest wall: **${strike.toFixed(2)}** (${kind}, ${distance_pts.toFixed(1)} pts from spot **${gex.spot.toFixed(2)}**)`,
    );
  }
  if (!stale && gex.change_pct != null) lines.push(`Underlying session: **${fmtPct(gex.change_pct)}**`);
  if (!lines.length) return null;
  return { title: "GEX posture", body: lines.join("\n") };
}

/** Wall bead dynamics — building/fading nodes from Vector wall history. */
export function wallDynamicsSection(
  vec: VectorFullState | null,
  sessionDate?: string | null,
): RichSection | null {
  if (vectorSnapshotStale(vec, Date.now(), sessionDate)) return null;
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
export function vectorDeskSection(
  vec: VectorFullState | null,
  sessionDate?: string | null,
  bucket: "watch" | "open" | "closed" = "open",
): RichSection | null {
  const p = vec?.play;
  if (!p) return null;
  const readMs = Date.now();
  const vectorStale = vectorSnapshotStale(vec, readMs, sessionDate);
  const lines: string[] = [];
  if (vectorStale) {
    const ageMs = vec?.dataAgeMs;
    lines.push(
      `**Last snapshot**${ageMs != null ? ` (~${Math.round(ageMs / 1000)}s old)` : ""} — Vector desk read may lag spot.`,
    );
    if (p.grade) lines.push(`Vector desk grade: **${p.grade}** (from prior snapshot)`);
    if (!lines.length) return null;
    return { title: "Vector desk", body: lines.join("\n\n"), bias: "neutral" };
  }
  // CLOSED plays: `p` is Vector's CURRENT read on the ticker, computed fresh at request time —
  // it has nothing to do with the specific, already-resolved position under review. Rendering the
  // full entry-zone/targets/invalidation/"Watch now" directive block (unchanged since before this
  // fix) for a closed play reads as a live, actionable call to re-enter a trade that already
  // exited, and badges it bullish/bearish as if it were guidance on the closed position — a
  // contract violation (identity/direction: whose call is this, and is it live) of the same shape
  // already fixed for the "Watch levels" section (see watchForSection's closed-bucket handling
  // above). Closed briefs keep only the informational grade/conviction snapshot, framed as
  // "since it closed" market context, with no directives and a forced-neutral bias.
  if (bucket === "closed") {
    lines.push(`Current Vector read: grade **${p.grade}** · conviction **${p.conviction}** (since this play closed)`);
    return { title: "Vector desk", body: lines.join("\n\n"), bias: "neutral" };
  }
  lines.push(`**${p.headline}** · grade **${p.grade}** · conviction **${p.conviction}**`);
  if (p.thesis) lines.push(p.thesis);
  if (p.entryZone) lines.push(`Entry zone: **${p.entryZone}**`);
  if (p.targets.length) lines.push(`Targets: ${p.targets.map((t) => `**${t}**`).join(" · ")}`);
  if (p.invalidation) lines.push(`Invalidation: **${p.invalidation}**`);
  // `starred[0]` is documented (VectorPlayEmit.starred, vector-play-engine.ts) to ALWAYS be the
  // headline itself — already rendered above, so skip it here. Slicing from 0 duplicated the
  // headline as the first "Watch now" bullet (live repro: NRG brief 2026-09-08).
  const watchNow = p.starred.slice(1, 5);
  if (watchNow.length) {
    lines.push("**Watch now:**\n" + watchNow.map((s) => `• ${s}`).join("\n"));
  }
  // Largo C2 — stale Vector play.bias must not badge bullish/bearish (early return above handles stale body).
  const bias =
    p.bias === "short" ? "bearish" : p.bias === "long" ? "bullish" : "neutral";
  return { title: "Vector desk", body: lines.join("\n\n"), bias };
}

/** Honest data freshness — mark age, scan age, vector staleness. */
export function dataFreshnessSection(ctx: SwingPlayBriefContext): RichSection | null {
  const { play, scanAsOf, scanSessionDay, sessionDate } = ctx;
  const vec = vectorOf(ctx);
  const lines: string[] = [];
  if (play.markAsOf) {
    lines.push(`Option mark as of **${etStampFromIso(play.markAsOf)}**`);
  } else if (play.markIsSync && playExpectsLiveOptionMark(play.status)) {
    lines.push("**Mark age unknown** — sync quote without timestamp; treat P&L as indicative");
  }
  if (scanAsOf) {
    const staleScan =
      scanSessionDay && sessionDate && scanSessionDay !== sessionDate;
    const stamp = etStampFromIso(scanAsOf);
    lines.push(
      staleScan
        ? `Swing scan: **${stamp}** (**prior session ${scanSessionDay}** — today's discovery not yet run)`
        : `Swing scan: **${stamp}**`,
    );
  }
  if (vec?.dataAgeMs != null && vec.dataAgeMs > 120_000) {
    lines.push(`Vector data **${Math.round(vec.dataAgeMs / 1000)}s** old — levels may lag live spot`);
  }
  const gexAgeMs = gexMatrixAgeMs(ctx.ecosystem?.gex_positioning);
  if (gexAgeMs != null && gexAgeMs > GEX_MATRIX_STALE_MS) {
    lines.push(
      `GEX matrix **${Math.round(gexAgeMs / 1000)}s** old — dealer posture may lag spot`,
    );
  }
  if (ctx.ecosystem?.flow_feed_fresh === false) {
    lines.push(
      "HELIX flow: **pipeline stale** — tape read may lag; not evidence of quiet flow",
    );
  }
  if (!lines.length) return null;
  return {
    title: "Data freshness",
    body: lines.join("\n"),
    bias: play.markIsSync && playExpectsLiveOptionMark(play.status) ? "bearish" : "neutral",
  };
}

/** Build all intelligence sections for the current play state. */
export function buildIntelSections(
  ctx: SwingPlayBriefContext,
  bucket: "watch" | "open" | "closed",
  opts?: { collapseIntel?: boolean },
): RichSection[] {
  const { play, ecosystem } = ctx;
  const vec = vectorOf(ctx);
  const out: RichSection[] = [];

  const narrative = tradeManagerNarrativeSection(ctx, bucket);
  if (narrative) out.push(narrative);

  out.push(whyThisSetupSection(play));

  const book = bookContextSection(play, ctx.openBook);
  if (book) out.push(book);

  const trackRecord = archetypeTrackRecordSection(play, ctx.archetypeTrackRecord);
  if (trackRecord) out.push(trackRecord);

  const cortexRead = cortexReadSection(play);
  if (cortexRead) out.push(cortexRead);

  const rank = laneRankSection(play, ctx.laneRows);
  if (rank) out.push(rank);

  const technicals = chartTechnicalsSection(vec, ctx.sessionDate);
  if (technicals) out.push(technicals);

  const levels = chartLevelsSection(ctx);
  if (levels) out.push(levels);

  const gex = gexPostureSection(ctx);
  if (gex) out.push(gex);

  const walls = wallDynamicsSection(vec, ctx.sessionDate);
  if (walls) out.push(walls);

  const vdesk = vectorDeskSection(vec, ctx.sessionDate, bucket);
  if (vdesk) out.push(vdesk);

  const flow = flowIntelSection(ecosystem, play, ctx.sessionDate);
  if (flow) out.push(flow);

  const catalysts = catalystsSection(ecosystem);
  if (catalysts) out.push(catalysts);

  const meridian = meridianCatalystSection(ctx);
  if (meridian) out.push(meridian);

  const meridianPeer = meridianPeerSection(ctx);
  if (meridianPeer) out.push(meridianPeer);

  const macro = macroTapeSection(ecosystem);
  if (macro) out.push(macro);

  const consensus = deskConsensusSection(ecosystem, play, bucket);
  if (consensus) out.push(consensus);

  const fresh = dataFreshnessSection(ctx);
  if (fresh) out.push(fresh);

  out.push(watchForSection(ctx, bucket));

  if (bucket === "open") {
    const hold = holdPlanSection(ctx);
    if (hold) out.push(hold);
  }

  if (bucket === "closed") {
    const roundTripAlreadyNoted = narrative?.body?.includes("Round-tripped past breakeven") ?? false;
    const lessons = lessonsSection(play, roundTripAlreadyNoted);
    if (lessons) out.push(lessons);
  }

  if (opts?.collapseIntel === false) return out;

  return collapseRedundantIntelSections(out, {
    hasNarrative: Boolean(narrative),
    bucket,
  });
}
