/**
 * Swing play brief — trade-manager narrative.
 * Largo-style coaching bullets: levels, dark pool, GEX king, max pain, flow, hold/break triggers.
 * Pure + deterministic — no LLM.
 */
import type { RichSection } from "@/lib/bie/rich-narrative";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import { swingActionDisplay } from "@/features/nighthawk/command-deck/play-card-lifecycle";
import type { SwingPlayBriefContext } from "./play-brief-types";
import {
  trustedHelixFlow,
  ageSecondsLabel,
  relativeAgeLabel,
  gexMatrixStale,
  vectorSnapshotStale,
  resolveGammaPosture,
  nighthawkLiveForSession,
  zerodteLiveForSession,
  optionMarkGenuinelyUnknown,
} from "./play-brief-absence";
import { etSessionDate } from "@/lib/largo/temporal/bar-session-date";
import type { VectorFullState } from "@/lib/bie/vector-full-state";
import type { VectorFreshnessBlock } from "@/lib/bie/vector-state-freshness";
import type { VectorDarkPoolLevel } from "@/features/vector/lib/vector-dark-pool-levels";
import { collectCoachingBullets } from "./play-brief-narrative-coaching";
import { fmtOptionUsd, fmtPremium, fmtPriceLevel } from "@/lib/fmt-money";
import { technicalsBias } from "./play-brief-technicals";
import { thesisHealthUncalibrated } from "./thesis-health";
import { mfeCaptureOutcome } from "./mfe-capture";

const MAX_BULLETS = 14;

function fin(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** For FLOW/aggregate dollar amounts (HELIX premium, dark-pool notional) — use fmtPremium
 *  from fmt-money (single source of truth for k/M/B scaling). NEVER use this for a
 *  per-contract option premium — see fmtOptionUsd below. */
function fmtFlowUsd(n: number): string {
  return fmtPremium(n);
}

// PER-CONTRACT option premium (live mark, stop/target rails) formatting is `fmtOptionUsd`,
// imported from @/lib/fmt-money above — see that module for the rounding-consistency history
// (this file previously carried its own byte-identical copy, first for a "+" sign defect fixed
// 2026-09-09, then for a roundFloats-vs-toFixed rounding mismatch fixed 2026-09-12; both are now
// fixed once, centrally, rather than re-patched in every file that copied this function).

function fmtPct(n: number, digits = 1): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

function distPct(spot: number, level: number): number {
  return ((level - spot) / spot) * 100;
}

function vectorOf(ctx: SwingPlayBriefContext): (VectorFullState & Partial<VectorFreshnessBlock>) | null {
  return ctx.vector ?? ctx.ecosystem?.vector_full_state ?? null;
}

export type LevelKind = "dark_pool" | "put_wall" | "call_wall" | "gamma_flip" | "king" | "max_pain" | "magnet";

export type FocalLevel = {
  price: number;
  kind: LevelKind;
  label: string;
  meta?: string;
  distancePct: number;
};

/**
 * All the REAL structural nodes this brief computes for a ticker, Vector-ladder-first with the
 * GEX-matrix fallback (same precedence as `chartLevelsSection`/`preferredGexWalls`,
 * play-brief-intel.ts), staleness-gated identically. Exported (2026-09-12, Ask Largo standing
 * mandate — Structure Ladder widget) so `play-brief-ladder.ts`'s rung builder can reuse this SAME
 * resolution instead of re-deriving "which wall/flip/king wins" a third way — exactly the "two
 * different precedence rules for one conceptual level" defect class this file's own comments
 * elsewhere (GEX king strike, nearest wall) document as already having shipped and been fixed
 * twice. Never call this with a different spot than the one the rest of the brief uses.
 */
export function collectFocalLevels(ctx: SwingPlayBriefContext, spot: number): FocalLevel[] {
  const vec = vectorOf(ctx);
  const gex = ctx.ecosystem?.gex_positioning;
  const out: FocalLevel[] = [];

  // Ask Largo standing mandate, readMs-anchor sweep follow-up to #5351: ctx is a required param
  // here — prefer its stamped readMs over a fresh wall-clock sample.
  const readMs = ctx.readMs ?? Date.now();
  const vectorStale = vectorSnapshotStale(vec, readMs, ctx.sessionDate);

  for (const dp of (vec?.darkPoolLevels ?? []).slice(0, 3)) {
    if (vectorStale) break;
    out.push({
      price: dp.strike,
      kind: "dark_pool",
      label: "dark pool",
      meta: `${dp.pct.toFixed(0)}% of DP volume · ${fmtFlowUsd(dp.premium)}`,
      distancePct: distPct(spot, dp.strike),
    });
  }

  const gexStale = gexMatrixStale(gex, readMs);
  const vecPutWall = vectorStale ? undefined : vec?.gexWalls?.putWalls?.[0]?.strike;
  const vecCallWall = vectorStale ? undefined : vec?.gexWalls?.callWalls?.[0]?.strike;
  const vecFlip = vectorStale ? undefined : vec?.gammaFlip;
  const putWall = vecPutWall ?? gex?.put_wall ?? null;
  const callWall = vecCallWall ?? gex?.call_wall ?? null;
  const flip = vecFlip ?? gex?.flip ?? null;
  const putWallFromStaleGex = vecPutWall == null && gex?.put_wall != null && gexStale;
  const callWallFromStaleGex = vecCallWall == null && gex?.call_wall != null && gexStale;
  const flipFromStaleGex = vecFlip == null && gex?.flip != null && gexStale;
  const vecKing = vectorStale ? undefined : vec?.ladder?.rows?.find((r) => r.isKing)?.strike;
  const kingFromGex = gex?.gex_king_strike;
  const king = vecKing ?? kingFromGex ?? null;
  const kingFromStaleGex = vecKing == null && kingFromGex != null && gexStale;
  const maxPain = vec?.maxPain ?? null;
  const magnet = vec?.magnet?.strike ?? null;

  if (putWall != null && !putWallFromStaleGex) {
    out.push({
      price: putWall,
      kind: "put_wall",
      label: "put wall",
      distancePct: distPct(spot, putWall),
    });
  }
  if (callWall != null && !callWallFromStaleGex) {
    out.push({
      price: callWall,
      kind: "call_wall",
      label: "call wall",
      distancePct: distPct(spot, callWall),
    });
  }
  if (flip != null && !flipFromStaleGex) {
    out.push({
      price: flip,
      kind: "gamma_flip",
      label: "gamma flip",
      distancePct: distPct(spot, flip),
    });
  }
  if (king != null && !kingFromStaleGex) {
    out.push({
      price: king,
      kind: "king",
      label: "GEX king",
      distancePct: distPct(spot, king),
    });
  }
  if (maxPain != null && !vectorStale) {
    out.push({
      price: maxPain,
      kind: "max_pain",
      label: "max pain",
      distancePct: distPct(spot, maxPain),
    });
  }
  if (magnet != null && !vectorStale) {
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
  const gex = ctx.ecosystem?.gex_positioning;
  // Same #5351/#5353-class fix as counterThesisLine above: prefer the request-wide
  // ctx.readMs anchor over a fresh local Date.now(), and thread it into resolveGammaPosture
  // (which previously defaulted to its OWN fresh Date.now(), a second clock read for the
  // same vec/gex snapshot this function already samples once below).
  const readMs = ctx.readMs ?? Date.now();
  const posture = resolveGammaPosture(ctx, vec, readMs);
  const vectorStale = vectorSnapshotStale(vec, readMs, ctx.sessionDate);
  const vecFlip = vectorStale ? undefined : vec?.gammaFlip;
  const flipFromStaleGex = vecFlip == null && gex?.flip != null && gexMatrixStale(gex, readMs);
  const flip = flipFromStaleGex ? null : (vecFlip ?? gex?.flip ?? null);

  if (!posture || posture === "unknown") {
    if (spot != null) return `Spot **${fmtPriceLevel(spot)}** — dealer gamma posture not resolved on this read.`;
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
      ? ` · γ-flip **${fmtPriceLevel(flip)}**${aboveFlip != null ? (aboveFlip ? " (spot above)" : " (spot below)") : ""}`
      : "";

  const snapshotStale = vectorStale;
  const snapshotAgeLabel = snapshotStale ? ageSecondsLabel(vec?.dataAgeMs) : null;
  const lead = snapshotStale
    ? `**Last snapshot**${snapshotAgeLabel != null ? ` (~${snapshotAgeLabel} old)` : ""}`
    : "**Right now**";

  return `${lead} — spot **${fmtPriceLevel(spot)}** · ${mechanic}${flipBit}`;
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
    `**Watch ${fmtPriceLevel(level.price)}** — major **dark pool** print (${level.meta ?? "institutional block"}). ` +
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
    `**${isCall ? "Call" : "Put"} wall ${fmtPriceLevel(level.price)}** (${fmtPct(level.distancePct)} from spot) — ${verb}. ` +
    `${action.charAt(0).toUpperCase()}${action.slice(1)}.`
  );
}

// BUG FIX (2026-09-20, Ask Largo standing mandate): resolveGammaPosture is a real FOUR-value
// regime — "long"/"short"/"transition"/"unknown" — and "transition" (verdict.ts: spot within 0.1%
// of the gamma flip) is a genuinely RESOLVED posture, not an absence. dealerPostureLine (this
// file, "sitting at gamma flip — regime can flip fast") and chartTechnicalsSection (play-brief-
// intel.ts, "Dealer gamma regime: transition (near flip)") already branch on it as its own third
// state; narrateKing/narrateMaxPain/narrateMagnet never did, so a real "at the flip" read silently
// fell into the same bucket as "short" or "not resolved". Live-plausible: any ticker whose spot is
// within 0.1% of its own gamma flip hits this on every read until it moves off the line.
function narrateKing(level: FocalLevel, posture: string | null): string {
  const pin =
    posture === "long"
      ? "Pin risk — dealers hedge into this strike; expect chop around it."
      : posture === "transition"
        ? "Dealers sitting at the gamma flip here — regime can tip either way fast."
        : "Max-gamma node — moves can accelerate through if wall fades.";
  return `**GEX king ${fmtPriceLevel(level.price)}** — largest gamma concentration on the board. ${pin}`;
}

function narrateMaxPain(level: FocalLevel, spot: number, posture: string | null): string {
  const pull = level.price < spot ? "below" : "above";
  // Mirrors narrateKing/narrateMagnet's posture branch (Largo C2) — this line used to assert
  // "when dealers are long gamma" unconditionally regardless of the actual computed regime, the
  // same class of bug already fixed for the GEX-king and gamma-magnet narrations (see the
  // magnetCoaching tests above, live NRG repro 2026-09-06). Caught live 2026-09-11 (RDDT SWING
  // brief): dealer posture line read "dealers short gamma", two bullets later this line still
  // said "pulls toward pin when dealers are long gamma" for the SAME read — a direct contradiction
  // a member could act on (max-pain pin gravity is a long-gamma phenomenon; asserting it while
  // short gamma overstates how much the level will hold).
  const gravity =
    posture === "long"
      ? "expiration gravity pulls toward pin when dealers are long gamma; don't fight the pin into close."
      : posture === "short"
        ? "dealers are short gamma here — pin gravity is weaker and price can run through max pain rather than settle on it."
        : posture === "transition"
          ? "dealers are sitting right at the gamma flip — pin gravity is unsettled until the regime resolves one way or the other."
          : "pin gravity depends on dealer gamma posture (not resolved on this read) — treat as a level to watch, not a settled pin.";
  return `**Max pain ${fmtPriceLevel(level.price)}** (${fmtPct(level.distancePct)} ${pull} spot) — ${gravity}`;
}

// NOTE (found 2026-09-20, Ask Largo standing mandate — logged, not removed, to keep this PR
// single-issue): this function is effectively DEAD for the magnet level specifically.
// tradeManagerNarrativeSection's focal-levels loop only calls it when
// `!bullets.some(b => /Gamma magnet/i.test(b))`, but `magnetCoaching` (play-brief-narrative-
// coaching.ts, wired in earlier via collectCoachingBullets) fires under the EXACT same
// existence/staleness gate as this level's own inclusion in collectFocalLevels (`vec?.magnet?.strike`
// + `!vectorStale`), so whenever this branch would run, magnetCoaching has already added a
// matching bullet and suppressed it. Same duplicate-implementation shape this repo has hit before
// (bookContextCoaching vs bookContextSection, #4110/#4116) — kept in sync here (see the transition-
// posture fix mirrored into magnetCoaching below) as defense-in-depth in case that gate ever
// changes, but the real fix for any magnet-narration bug lives in magnetCoaching, not here.
function narrateMagnet(level: FocalLevel, posture: string | null): string {
  const pin =
    posture === "long"
      ? "Pin gravity — dealers hedge into this strike; chop likely."
      : posture === "transition"
        ? "Dealers sitting at the gamma flip — this node's pull is unsettled until the regime resolves."
        : "Pivot node — acceleration risk if magnet fails.";
  const meta = level.meta ? ` ${level.meta}` : "";
  return `**Gamma magnet ${fmtPriceLevel(level.price)}** (${fmtPct(level.distancePct)} from spot) — ${pin}${meta}`;
}

function narrateFlip(level: FocalLevel, play: TerminalPlay, spot: number): string {
  // BUG FIX (2026-09-13, Ask Largo standing mandate) — same class of bug as narrateMaxPain's own
  // fix above (live RDDT repro, 2026-09-11): this picked "Lose"/"Reclaim" purely from
  // `play.direction`, never checking which side of the flip spot is actually on. "Lose" only
  // makes sense while spot is still above the flip; once spot has already crossed through it the
  // play is already in the unfavorable regime and needs to "Reclaim," not "Lose" it again — and
  // the mirror case for a SHORT already trading above the flip. Comparing spot to the level
  // itself (like narrateMaxPain does) rather than inferring posture from trade direction alone.
  const spotAboveFlip = spot > level.price;
  const longBreak =
    play.direction === "LONG"
      ? spotAboveFlip
        ? `Lose **${fmtPriceLevel(level.price)}** → dealer posture turns against longs — tighten or trim.`
        : `Reclaim **${fmtPriceLevel(level.price)}** → needed to restore dealer support for longs.`
      : spotAboveFlip
        ? `Lose **${fmtPriceLevel(level.price)}** → needed to confirm the short thesis.`
        : `Reclaim **${fmtPriceLevel(level.price)}** → invalidates short gamma thesis.`;
  return `**Gamma flip ${fmtPriceLevel(level.price)}** — regime line. ${longBreak}`;
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
    `**HELIX tape** (${flow.window_hours}h) — **${bias}** · calls ${fmtFlowUsd(flow.call_premium)} · puts ${fmtFlowUsd(flow.put_premium)} · ${flow.print_count} prints.`;

  if (alignedLong) tape += " Flow stepping in on the call side **supports** the long swing.";
  else if (alignedShort) tape += " Put flow **aligns** with the short thesis.";
  else if (conflict) tape += " Flow **conflicts** with swing direction — size down until tape agrees.";

  const anomaly = ctx.ecosystem?.recent_anomalies?.[0];
  if (anomaly) {
    // Time-label this — recent_anomalies is a last-24h feed while the tape above is a 6h read,
    // so an anomaly can point the opposite direction from the tape's own bias without either
    // read being wrong. Undated, the two sentences read as a flat contradiction (see
    // relativeAgeLabel's own doc comment, live CRWD repro 2026-09-16).
    const ageLabel = relativeAgeLabel(anomaly.detected_at);
    const agePart = ageLabel ? ` (${ageLabel})` : "";
    tape += ` Earlier anomaly${agePart}: **${anomaly.anomaly_type}** — ${anomaly.detail}.`;
  }

  return tape;
}

// A SELL recommendation used to always render as "thesis or ladder fired" (FINDINGS 2026-09-10,
// live repro NRG SWING:NRG:34: the manage engine forced EXIT purely on "expiry_risk" — manage.ts's
// own comment: "too little time / theta cliff... (intact thesis)" — while the same play-brief's own
// "What to watch" section correctly said "Thesis intact" and the trim ladder showed no rung fired.
// The generic line asserted a broken thesis or a fired ladder that neither the data nor the rest of
// the brief supported. manageReason (the deciding manage.ts rung, threaded through live-plays.ts ->
// horizon-plays.ts -> adapters.ts) lets this state the REAL reason instead of guessing.
function sellReasonClause(
  reason: TerminalPlay["manageReason"] | undefined,
  thesisLevel: TerminalPlay["thesisBreak"] | undefined,
  // GAP FOUND (2026-09-18, Ask Largo standing mandate): manage.ts's `evaluateSwingManagement`
  // computes a full, SPECIFIC prose reason for every verdict (the exact breached level, e.g.
  // "underlying 145.20 ≤ structural stop 148.00 — LONG thesis broken in underlying terms") and
  // manage-sync.ts persists it verbatim every tick (event_json.reason) — but until now nothing
  // between that write and this narrative function ever read it back out, so a member reading
  // "thesis broke" had no way to see WHAT broke or at WHAT level, even though the desk had computed
  // and stored exactly that on the same tick that fired the SELL. See TerminalPlay.manageReasonDetail
  // for the full plumbing. Used ONLY for the two cases below that previously had no specifics at
  // all (structural_stop/thesis_stop, and the unmatched-rung fallback) — the other rungs already
  // carry deliberately-curated, member-clean wording (expiry_risk/time_stop's "thesis still intact"
  // framing in particular must NOT be replaced by the raw internal reason string, which reads very
  // differently) and are left untouched.
  reasonDetail?: TerminalPlay["manageReasonDetail"],
): string {
  switch (reason) {
    case "expiry_risk":
      return " — time-based: DTE nearing the lane's theta cliff (thesis still intact)";
    case "structural_stop":
    case "thesis_stop":
      return reasonDetail ? ` — ${reasonDetail}` : " — thesis broke";
    case "premium_stop":
      return " — premium stop hit";
    case "catalyst_shift":
      return " — catalyst shifted against the thesis";
    case "regime_shift":
      return " — regime shifted against the thesis";
    case "time_stop":
      // Same "generic label reads as a broken thesis" trap expiry_risk was fixed for above (the
      // FINDINGS 2026-09-10 NRG repro) — a bare "time stop hit" tells a member nothing about WHY,
      // and easily reads as a ladder/thesis event. manage.ts's own dead-money time_stop rung fires
      // on stagnant UNDERLYING progress toward its target over enough sessions (thesisProgress01,
      // thesis-progress.ts) — it is NOT about DTE (that's expiry_risk) and NOT a thesis break, so a
      // position can be sitting on a real premium gain (leverage/IV) while still time-stopping here.
      return " — time-based: held long enough that the underlying has stalled toward its target (thesis still intact)";
    default:
      // No matching rung (or none yet). Prefer the specific persisted reason when the caller has
      // one (an unmapped/future rung whose prose is still real and honest); otherwise fall back to
      // the spot-detected structural break when that's what actually drove the EXIT
      // (structuralBreakFromSpot in live-plays.ts), or say nothing rather than guess at a
      // mechanism the data doesn't actually confirm.
      if (reasonDetail) return ` — ${reasonDetail}`;
      return thesisLevel?.level === "break" ? " — thesis broke" : "";
  }
}

// BUG FIX (2026-09-17, Ask Largo standing mandate): the TRIM branch of actionNarrative (below)
// always rendered as if the profit ladder's own rail were the reason for the recommendation —
// "Desk says TRIM — next rail at +X%" — regardless of which manage.ts rung actually fired.
// manage.ts's own rung precedence (see its file header) has FIVE distinct advisory rungs that all
// map to the same TAKE_PARTIAL action: catalyst_shift, regime_shift, profit_ladder, flow_decay,
// rel_strength_loss, vol_collapse — only one of those (profit_ladder) is actually ABOUT the rail.
// Live repro, 2026-09-17, three real open positions simultaneously: CRWD SWING:CRWD:39
// (manageReason "catalyst_shift", peak +39.2%/now -16.3%) and AAPL SWING:AAPL:38/:37
// (manageReason "rel_strength_loss", neither ever above +18.6% peak) all rendered "Desk says TRIM
// — next rail at +100%" — a rail none of the three had ever come close to, while the brief never
// disclosed the REAL reason (a broken catalyst / lost relative strength) anywhere in the bullet
// that is supposed to explain the recommendation. This is the exact same defect class as the
// SELL-side "thesis or ladder fired" bug fixed above (FINDINGS 2026-09-10, sellReasonClause) —
// TRIM never got the equivalent fix. Mirrors sellReasonClause's shape and, for the three shared
// rungs (catalyst_shift/regime_shift), its exact wording for consistency; flow_decay/
// rel_strength_loss/vol_collapse reuse the same reason text manage.ts itself already generates
// (manage.ts:345/348/351) so the brief never invents a second description of the same event.
function trimReasonClause(reason: TerminalPlay["manageReason"] | undefined): string {
  switch (reason) {
    case "catalyst_shift":
      return " — catalyst shifted against the thesis";
    case "regime_shift":
      return " — regime shifted against the thesis";
    case "flow_decay":
      return " — the flow that seeded this thesis has faded";
    case "rel_strength_loss":
      return " — lost relative strength vs its benchmark";
    case "vol_collapse":
      return " — IV crush eating premium faster than the underlying pays";
    default:
      // profit_ladder (the rail text right after this clause already explains it), undefined
      // (no manage-sync rung yet), or any other rung — say nothing rather than guess.
      return "";
  }
}

function actionNarrative(play: TerminalPlay, bucket: "watch" | "open" | "closed"): string | null {
  if (bucket === "closed") return null;

  const rec = play.recommendation ?? "HOLD";
  const health = thesisHealthUncalibrated(play.thesisHealth) ? null : play.thesisHealth?.health;
  const lines: string[] = [];

  if (bucket === "watch") {
    const gateCount = play.gateBlocks?.length ?? 0;
    const actionLabel =
      swingActionDisplay(play)?.label ?? play.swingEntryAction?.toUpperCase() ?? rec;
    lines.push(
      `**Entry stance** — ${actionLabel}. ` +
        (gateCount > 0
          ? // Reason text + unlock timing live in watchGateCoaching's own bullet
            // (play-brief-narrative-coaching.ts), pushed immediately after this one for the SAME
            // watch bucket (collectCoachingBullets, right after actionNarrative in
            // tradeManagerNarrativeSection). This used to re-render the first two gates' full
            // `code: reason` text here too, so a gated watch play's "Trade manager read" carried
            // the identical gate codes+reasons TWICE back-to-back — once as "Clear gates: ..."
            // here, once as "Gates blocking entry — ..." in the very next bullet. The section's
            // own de-dup (`seen`, keyed on each line's first 48 chars) never caught it because the
            // two bullets open with different wording ("Entry stance —" vs "Gates blocking
            // entry —"), even though their content was the same (live EWY/NRG WATCH reads,
            // 2026-09-10). State the count here; the reason text has exactly one home below.
            `${gateCount} gate${gateCount === 1 ? "" : "s"} blocking entry — see below.`
          : rec === "BUY"
            ? "No mechanical gates blocking — wait for trigger geometry."
            : "Wait for setup maturity before sizing."),
    );
    return lines.join(" ");
  }

  // Honest RELATIVE retracement, not a percentage-POINT subtraction of two already-percentage
  // numbers (FINDINGS 2026-09-10: "Gave back 93%" on a play still up +39.8% — peak 132.7 minus
  // pnl 39.8 read as 93 points, which the "gave back X%" phrasing unambiguously misreads as a
  // near-total round-trip). mfeCaptureOutcome (mfe-capture.ts) is the SAME math already shipped
  // for CLOSED-play post-mortems, reused here for a LIVE play's CURRENT pnl (mfeCapturePct is
  // always null pre-close — that field only exists after grading). Computed before the rec-branch
  // below so the TRIM line itself can check for a round-trip too (see its own comment).
  const giveback = mfeCaptureOutcome(play.pnlPct, play.peak, null);
  // Whether ANY tranche has already been banked — the round-trip bullet below reads `pnlPct`/`peak`
  // off the RUNNER leg only (same basis as `blendedPnlPct` in play-brief.ts, which this deliberately
  // does not import — play-brief.ts already imports FROM this file, so importing back would be
  // circular; the fraction-summed check is duplicated here on purpose, not by oversight). Live repro
  // (CRWD SWING:CRWD:19, 2026-09-14): 50% banked at +100%, runner round-tripped from +130% to -10% —
  // the unqualified bullet below read as "the position round-tripped", when the BLENDED P&L (what a
  // member actually made/lost) was still +45.3%, a solid win. That is a materially different message
  // from the NRG repro this bullet was originally built for (round-tripped with ZERO ever banked —
  // see the "Product-honesty gap" comment a few lines down), so the two must not read identically.
  const anyTrimBanked = (play.exitPolicy?.trim_levels ?? []).some((t) => t.fired);

  if (rec === "TRIM") {
    const trimLevels = play.exitPolicy?.trim_levels ?? [];
    const next = trimLevels.find((t) => !t.fired);
    // "Bank partial into strength; don't give back peak" only makes sense while there is still a
    // peak worth protecting. Once the play has already round-tripped past breakeven into a loss
    // (live repro: NN SWING:NN:32, 2026-09-10 — TRIM recommendation, peak +24.4%, pnl -34.6%), the
    // very next bullet already states the peak is gone — "into strength"/"don't give back peak"
    // then reads as stale advice contradicting the sentence right after it. Drop the strength
    // clause in that case; the round-trip bullet below already carries the real, current guidance.
    //
    // Product-honesty gap (live NRG repro, 2026-09-11: round-tripped from +132.7% to +2% with
    // ZERO trim ever banked): "Desk says TRIM — bank partial into strength" reads as an
    // instruction that has already happened or that the platform will act on. Neither is true —
    // the whole product is advisory-only (managementFor in adapters.ts already carries the
    // in-code comment "ADVISORY (we recommend, you execute)", but that disclosure never reached
    // the member-facing narrative). The costliest version of this gap is exactly the
    // trimsFired===0 case: the trigger has already been crossed (that's why rec is TRIM at all)
    // yet NOTHING has been banked, so the position is still 100% exposed to a full round-trip
    // while the copy reads like protection is already in motion. Disclose plainly in that case,
    // BEFORE the round-trip happens — the round-trip bullet below only covers the aftermath.
    const trimsFired = trimLevels.filter((t) => t.fired).length;
    // "next rail at +X%" reads as forward-looking ("coming up"), but per the comment above this
    // rung has ALREADY been crossed whenever rec is TRIM at all -- live repro: CG SWING:CG:25,
    // 2026-09-14, pnlPct +169.2%, next.trigger_pct 100 (unfired) -- "next rail at +100%" while
    // already 69 points past it. Checked directly against the live pnlPct (not just trusting the
    // "always crossed" comment) so the wording self-corrects if that invariant ever doesn't hold:
    // only the already-past case gets the past-tense framing, a genuinely-ahead rail (or an
    // unknown current pnl) keeps the original "next rail" wording untouched.
    const railAlreadyCrossed =
      next != null && typeof play.pnlPct === "number" && play.pnlPct >= next.trigger_pct;
    const railClause = next
      ? railAlreadyCrossed
        ? ` — **+${next.trigger_pct}%** rail already cleared (now **${fmtPct(play.pnlPct!)}**), not yet banked`
        : ` — next rail at **+${next.trigger_pct}%**`
      : "";
    const reasonClause = trimReasonClause(play.manageReason);
    lines.push(
      `**Desk says TRIM**${reasonClause}${railClause}.` +
        (giveback?.kind === "round_trip" ? "" : " Bank partial into strength; don't give back peak.") +
        (trimsFired === 0
          ? " Nothing's banked yet — this is advisory only; place the trim yourself, the desk does not execute trades."
          : ""),
    );
  } else if (rec === "SELL") {
    lines.push(
      `**Exit now**${sellReasonClause(play.manageReason, play.thesisBreak, play.manageReasonDetail)}. Flatten per manage engine.`,
    );
  } else if (rec === "BUY" && bucket === "open") {
    // BUG FIX (Ask Largo standing mandate, 2026-09-21): the same "generic label swallows the real
    // manage.ts rung" defect already fixed on the SELL side (2026-09-10, sellReasonClause) and the
    // TRIM side (2026-09-17, trimReasonClause) had a third, previously-unfixed instance here.
    // manage.ts's `add_eligible` rung (thesis progressing ≥50% toward target AND the option not
    // underwater — thesis-progress.ts's `addEligibleFromProgress`, wired live in
    // swing-active-refresh) maps to `SwingManageAction "ADD"`, which `recommendationFromManageAction`
    // (adapters.ts) turns into `Recommendation "BUY"` for an OPEN position. But this branch didn't
    // exist, so rec==="BUY" fell into the generic `else` HOLD branch below ("Hold the line ... Let
    // the trade work while structure holds") — silently discarding the desk's actual "consider
    // adding" advisory. Gated on `bucket === "open"` only: a WATCH play's rec==="BUY" means "enter
    // the setup" (already narrated by the watch branch above, a completely different action from
    // "add to an existing position"), so this must not fire there.
    lines.push(
      "**Consider adding** — thesis has progressed well toward target and the option isn't underwater " +
        "(advisory only; the desk does not execute trades).",
    );
  } else {
    lines.push(
      `**Hold the line**${health != null ? ` — thesis health **${health}%**` : ""}. ` +
        (health != null && health < 45
          ? "Health fading — tighten stop or trim into any bounce."
          : "Let the trade work while structure holds."),
    );
  }

  if (giveback?.kind === "round_trip") {
    lines.push(
      anyTrimBanked
        ? `**Runner round-tripped past breakeven** — was up **${giveback.peakPct.toFixed(0)}%** at peak, now **${giveback.exitPnlPct.toFixed(0)}%**; part of this position is already banked at a profit — consider protecting what's left of the runner.`
        : `**Round-tripped past breakeven** — was up **${giveback.peakPct.toFixed(0)}%** at peak, now **${giveback.exitPnlPct.toFixed(0)}%** — consider protecting what's left.`,
    );
  } else if (giveback?.kind === "capture" && giveback.capturePct < 75) {
    lines.push(
      `Gave back **${(100 - giveback.capturePct).toFixed(0)}%** of peak — consider protecting runner.`,
    );
  }

  return lines.join(" ");
}

function breakTrigger(
  play: TerminalPlay,
  focal: FocalLevel[],
  flip: number | null,
  preEntry = false,
): string | null {
  // Candidate levels are pulled from `focal`, which is sorted by UNSIGNED distance from spot —
  // "nearest" does not mean "on the right side". A dark-pool print (any strike, any side — see
  // narrateDarkPool's own side detection off `level.price < spot`) or, in theory, a put wall can
  // sit ABOVE spot; picking the nearest match without checking its side used to let a LONG's
  // "Break watch — lose $X on a closing basis" cite an X that is currently ABOVE spot — i.e. a
  // level the play has not even reached yet, not a support it could "lose". Same shape for SHORT's
  // reclaim level and for the LONG flip fallback: a flip currently above spot cannot be "lost" on
  // a close below spot either. Filtering each candidate to the side that actually makes the
  // English true (support strictly below spot, resistance strictly above) is the fix; distancePct
  // is signed ((price-spot)/spot*100) so this needs no extra spot plumbing.
  //
  // BUG FIX (2026-09-15, forensic batch 30): "king" (the GEX king strike) was never a candidate
  // here, even though it's in the same nearest-sorted `focal` array buildStructureLadder's own
  // riskTheOtherSide (play-brief-ladder.ts) already treats as real structure. Live on CRWD: the
  // king sat 8x nearer than the put wall, so the ladder widget correctly named the king as the
  // real nearest risk while this "Break watch" bullet — in the same response — cited the far more
  // distant put wall. Added to both predicates so `.find()` (nearest-first) picks whichever real
  // wall, including king, is actually closest.
  const support = focal.find(
    (l) => (l.kind === "put_wall" || l.kind === "dark_pool" || l.kind === "king") && l.distancePct < 0,
  )?.price;
  const resist = focal.find(
    (l) => (l.kind === "call_wall" || l.kind === "king") && l.distancePct > 0,
  )?.price;

  // FINDING (Ask Largo standing mandate, 2026-09-19): both branches below always closed with
  // POSITION-MANAGEMENT language ("exit or cut size" / "cover shorts") — correct for an OPEN play
  // (there IS a position to exit/cover) but nonsensical for a WATCH play, which has never been
  // entered. The already-shipped CLOSED-bucket fix (see resolveBreakInvalidation's own history)
  // stopped one bucket short: it suppressed this callout entirely for CLOSED, but left WATCH using
  // the identical OPEN-only wording — verified still true via play-brief.test.ts's own
  // "invalidation prefers a real per-ticker technical break level" test, whose fixture defaults to
  // `status: "WATCH"` yet asserted the literal "exit or cut size" string. `preEntry` (derived from
  // the play's status, same rule in both callers) swaps the trailing clause to entry-appropriate
  // language — the level-selection logic above is unchanged and still correct for both buckets.
  // Both call sites now pass it: resolveBreakInvalidation (fixed by #5253) and
  // tradeManagerNarrativeSection's own "Break watch" bullet (fixed here, same day — that call site
  // is NOT OPEN-only in production despite #5253's PR body assuming so; see its own call-site
  // comment for the live repro that caught it).
  if (play.direction === "LONG") {
    const flipBelowSpot = flip != null && focal.some((l) => l.kind === "gamma_flip" && l.distancePct < 0);
    const stop = support ?? (flipBelowSpot ? flip : null);
    if (stop != null) {
      const action = preEntry ? "this setup is no longer live — skip it" : "exit or cut size";
      return `**Break watch** — lose **${fmtPriceLevel(stop)}** on a closing basis → structural support failed; ${action}.`;
    }
  } else if (play.direction === "SHORT" && resist != null) {
    const action = preEntry ? "this setup is no longer live — skip it" : "cover shorts";
    return `**Break watch** — reclaim **${fmtPriceLevel(resist)}** → resistance broken; ${action}.`;
  }
  return null;
}

/**
 * The real, per-ticker technical break level (put wall / dark pool / gamma flip for LONG,
 * call wall for SHORT) — the same staleness-guarded spot/flip/focal-level computation
 * `tradeManagerNarrativeSection` uses to build its "Break watch" bullet (see `breakTrigger`
 * above), exposed standalone so `play-brief.ts`'s headline `envelope.invalidation` field can use
 * it instead of falling straight to a raw commit-gate reason.
 *
 * WHY THIS EXISTS: play-brief.ts's `invalidation` fallback used to go straight from
 * `thesisBreak.level === "break"` to `play.gateBlocks?.[0]?.reason` — but for a WATCH/pending
 * play with no thesis-break event yet, the first blocking gate is very often a SYSTEM-WIDE
 * operational gate (e.g. G-S12 "trading-halt feed unavailable"), not anything specific to the
 * ticker. That gate reason is IDENTICAL across every gate-blocked ticker in the board at once
 * (confirmed live 2026-09-09: NBIS, CRCL and MU — three different setups, three different
 * archetypes — all showed the literal same "Trading-halt feed unavailable — desk will not open
 * until halt/LULD data recovers." string in the UI's labeled "Invalidation" callout), even though
 * a real per-ticker level (gamma flip / put wall) was already computed and displayed elsewhere in
 * the very same brief. Preferring this technical level keeps `invalidation` a genuine,
 * differentiating trade fact per the Largo product contract's precision principle, rather than a
 * copy-pasted infra caveat that tells a trader nothing about the setup in front of them.
 *
 * Returns null (never fabricates) when no live spot or no real level is computable — callers keep
 * falling back to the gate reason / premium stop in that case, same as before this existed.
 */
export function resolveBreakInvalidation(ctx: SwingPlayBriefContext): string | null {
  const { play } = ctx;
  const vec = vectorOf(ctx);
  // Ask Largo standing mandate, readMs-anchor sweep follow-up to #5351: ctx is a required param
  // here — prefer its stamped readMs over a fresh wall-clock sample.
  const readMs = ctx.readMs ?? Date.now();
  const vectorStale = vectorSnapshotStale(vec, readMs, ctx.sessionDate);
  const gex = ctx.ecosystem?.gex_positioning;
  const gexStale = gexMatrixStale(gex, readMs);
  const spot = fin(vectorStale ? undefined : vec?.spot) ?? fin(gexStale ? undefined : gex?.spot);
  if (spot == null) return null;

  const vecFlipRaw = vectorStale ? undefined : vec?.gammaFlip;
  const flipRaw = fin(vecFlipRaw) ?? fin(gex?.flip);
  const flipFromStaleGex = vecFlipRaw == null && gex?.flip != null && gexStale;
  const flip = flipFromStaleGex ? null : flipRaw;

  const focal = collectFocalLevels(ctx, spot);
  // Only OPEN/HOLD/TRIM actually hold a position to exit/cover; every other status reaching here
  // (WATCH, COMMIT, etc. — CLOSED is short-circuited by the caller before this function runs) is
  // pre-entry. Mirrors play-brief.ts's own `statusBucket` open-set without importing it (duplicated
  // deliberately — same pattern as this codebase's other small per-file status checks).
  const preEntry = play.status !== "OPEN" && play.status !== "HOLD" && play.status !== "TRIM";
  return breakTrigger(play, focal, flip, preEntry);
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
    const stop = ep.stop_premium != null ? fmtOptionUsd(ep.stop_premium) : "—";
    const target = ep.target_premium != null ? fmtOptionUsd(ep.target_premium) : "—";
    rails.push(`stop **${stop}** · target **${target}**`);
  }
  if (!rails.length) return null;
  return `**Manage rails** — ${rails.join(" · ")}. Honor stops on closing basis; bank trims into strength.`;
}

/** Steelman the opposing case — honest bear/bull risks for the swing direction. */
/** `vectorConflictAlreadyNoted` — crossDeskCoaching (play-brief-narrative-coaching.ts) derives the
 *  identical Vector-vs-swing-direction misalignment from the identical vec.play input, earlier in
 *  the same bullet list, and already names this exact headline in its "Cross-desk friction" bullet
 *  when it fires. Without this flag both bullets AND this counter-thesis reason cite the same
 *  headline as three separate facts in one document — live repro: NRG brief 2026-09-09, "Cross-desk
 *  friction — Vector bearish (...)" and "Counter-thesis (bear case) — Vector bearish (...)" both
 *  present. The other counter-thesis reasons (EMA stack, fading pillar, GEX walls) are independent
 *  evidence and stay untouched — only the Vector-specific reason is omitted when redundant. */
export function counterThesisLine(
  ctx: SwingPlayBriefContext,
  play: TerminalPlay,
  spot: number | null,
  vectorConflictAlreadyNoted?: boolean,
): string | null {
  const vec = vectorOf(ctx);
  const eco = ctx.ecosystem;
  const reasons: string[] = [];
  // BUG FIX (2026-09-21, Ask Largo standing mandate — #5351/#5353 follow-up): this function used
  // to sample the wall clock FIVE separate times (one bare `Date.now()` per staleness check below)
  // instead of consulting `ctx.readMs` — the single canonical "now" `composeSwingPlayBrief` stamps
  // once before any section builds, per #5351's own doc comment on `SwingPlayBriefContext.readMs`.
  // That's the identical bug shape #5351/#5353 already fixed twice in this same file/its sibling
  // (`dataFreshnessSection`, `collectBriefUnavailableSources`): a member could see this bullet
  // judge `vec`/`gexForWalls` fresh while another section of the SAME brief — built off the shared
  // `ctx.readMs` — judges the identical snapshot stale, purely from wall-clock drift between calls
  // within one request, not from any real data change. Threading `ctx.readMs` here closes the last
  // un-migrated call site in this file that both (a) already receives `ctx` and (b) drives a
  // member-visible narrative bullet ("Counter-thesis" in Trade manager read).
  const readMs = ctx.readMs ?? Date.now();

  const flow = trustedHelixFlow(eco);
  if (flow) {
    if (play.direction === "LONG" && flow.put_premium > flow.call_premium * 1.2) {
      reasons.push(`HELIX put-led (${fmtFlowUsd(flow.put_premium)} vs ${fmtFlowUsd(flow.call_premium)} calls)`);
    } else if (play.direction === "SHORT" && flow.call_premium > flow.put_premium * 1.2) {
      reasons.push(`HELIX call-led (${fmtFlowUsd(flow.call_premium)} vs ${fmtFlowUsd(flow.put_premium)} puts)`);
    }
  }

  const nh = nighthawkLiveForSession(eco?.nighthawk_recent, ctx.sessionDate);
  const z = zerodteLiveForSession(eco?.zerodte_today, ctx.sessionDate);
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
  // Same Largo C2 gap as stale GEX walls/posture (#4355/#4364): steelmanning Vector desk bias
  // off a stale snapshot reads like a live opposing read.
  if (!vectorSnapshotStale(vec, readMs, ctx.sessionDate) && !vectorConflictAlreadyNoted) {
    if (play.direction === "LONG" && vp?.bias === "short") {
      reasons.push(`Vector bearish (${vp.headline ?? vp.grade ?? "desk read"})`);
    } else if (play.direction === "SHORT" && vp?.bias === "long") {
      reasons.push(`Vector bullish (${vp.headline ?? vp.grade ?? "desk read"})`);
    }
  }

  if (spot != null) {
    const gexForWalls = eco?.gex_positioning;
    const vectorStaleForWalls = vectorSnapshotStale(vec, readMs, ctx.sessionDate);
    const vecCallWall = vectorStaleForWalls ? undefined : vec?.gexWalls?.callWalls?.[0]?.strike;
    const vecPutWall = vectorStaleForWalls ? undefined : vec?.gexWalls?.putWalls?.[0]?.strike;
    const callWall = vecCallWall ?? gexForWalls?.call_wall ?? null;
    const putWall = vecPutWall ?? gexForWalls?.put_wall ?? null;
    // Same Largo C2 gap #4355/#4360 fixed for dealer posture: a wall level cited from the GEX-only
    // fallback (no live Vector wall) can be from a stale matrix — steelmanning "call wall overhead"
    // off a stale snapshot is the same dishonesty as "dealers long gamma" off one. Gated per-wall,
    // not both-or-nothing, since one side can come from a live Vector read while the other falls
    // back to stale GEX.
    const gexStaleForWalls = gexMatrixStale(gexForWalls, readMs);
    const callWallFromStaleGex = vecCallWall == null && gexForWalls?.call_wall != null && gexStaleForWalls;
    const putWallFromStaleGex = vecPutWall == null && gexForWalls?.put_wall != null && gexStaleForWalls;
    if (play.direction === "LONG" && callWall != null && callWall > spot && !callWallFromStaleGex) {
      const d = distPct(spot, callWall);
      if (d < 3) reasons.push(`call wall **${fmtPriceLevel(callWall)}** overhead (${d.toFixed(1)}%)`);
    }
    if (play.direction === "SHORT" && putWall != null && putWall < spot && !putWallFromStaleGex) {
      const d = Math.abs(distPct(spot, putWall));
      if (d < 3) reasons.push(`put wall **${fmtPriceLevel(putWall)}** below (${d.toFixed(1)}%)`);
    }
  }

  const vectorStale = vectorSnapshotStale(vec, readMs, ctx.sessionDate);
  const ema = !vectorStale ? vec?.technicals?.emaStack ?? null : null;
  if (play.direction === "LONG" && ema === "down") reasons.push("bear EMA stack on chart");
  if (play.direction === "SHORT" && ema === "up") reasons.push("bull EMA stack on chart");

  // BUG FIX (2026-09-15, Ask Largo standing mandate, sibling of the play-brief.ts evidenceFromContext
  // fix same day): `vecPosture` used to be `vec?.regime?.posture ?? null`, treating the literal
  // string "unknown" (Vector genuinely could not resolve a regime) as an equally-resolved answer to
  // "long"/"short" — the exact bug `resolveGammaPosture` (play-brief-absence.ts) was fixed for on
  // 2026-09-12, just never ported here. That silently dropped a real, resolved GEX-matrix-fallback
  // dealer-posture counter-thesis reason whenever Vector's own read landed on "unknown", understating
  // the "corroborated across N independent reads" count just below. `resolveGammaPosture` already
  // encodes the same stale-GEX gating `skipGexPosture` used to apply by hand, so it fully replaces
  // this block.
  const posture = resolveGammaPosture(ctx, vec, readMs);
  if (play.direction === "LONG" && posture === "long") reasons.push("dealer long-gamma pins rallies");
  if (play.direction === "SHORT" && posture === "short") reasons.push("dealer short-gamma can squeeze shorts");

  // Same guard as degradedReadLine/thesisPillarCoaching (thesis-health.ts's thesisHealthUncalibrated):
  // a committed row with no setup/entry/signal inputs wired gets FORCED default pillar labels
  // (persistence: "unknown", etc — see UNCALIBRATED_PILLAR_LABELS), and degradeFromManage() then
  // force-sets the persistence pillar's status straight off the manage-engine action
  // (TAKE_PARTIAL/EXIT_RUNNER -> "faded") regardless of calibration. Reading `.status` here with no
  // guard steelmanned a fabricated "fading pillar Persistence" bear/bull case on rows whose own
  // Thesis-health section (thesisHealthSection, play-brief.ts) says "pillar breakdown not shown" —
  // confirmed live on 3 committed positions, different tickers/directions/scores, always the
  // byte-identical clause. 4th instance of this exact unguarded-pillar-read shape in this file; the
  // other three (degradedReadLine, thesisPillarCoaching, thesisHealthSection) were already fixed.
  const faded = thesisHealthUncalibrated(play.thesisHealth)
    ? undefined
    : play.thesisHealth?.pillars?.find((p) => p.status === "lost" || p.status === "faded");
  if (faded && (!play.thesisBreak?.level || play.thesisBreak.level === "intact")) {
    reasons.push(`fading pillar **${faded.label}**`);
  }

  if (!reasons.length) return null;

  const side = play.direction === "LONG" ? "bear" : "bull";
  const shown = reasons.slice(0, 3);
  // A single-reason counter-thesis and one where 3 independent desks/reads agree were rendering
  // with identical prose weight — "Counter-thesis (bear case) — <reason(s)>" either way — so a
  // member had no way to tell an isolated signal from a corroborated one without counting clauses
  // themselves. Live-confirmed both shapes exist today (AAPL: 3 reasons: call wall + EMA stack +
  // dealer posture; NRG/NN/META: exactly 1 reason each). The count itself is never fabricated —
  // it's `reasons.length`, the same array already gathered above — so this only labels evidence
  // strength honestly, the same discipline as the Largo product contract's confidence-omission
  // rule (state real weight, never invent it, never flatten it away either).
  const weight =
    shown.length >= 2
      ? `corroborated across ${shown.length} independent reads — `
      : "a single, uncorroborated signal — ";
  return `**Counter-thesis (${side} case)** — ${weight}${shown.join(" · ")}. If this wins, honor invalidation — don't hope.`;
}

/**
 * Roll-history disclosure (Ask Largo ownership mandate, 2026-09-11) — a chain's `roll_seq`
 * thread has always been available to `record.ts`'s composite, but the narrative never mentioned
 * it, so a member reading "Trade manager read" on a rolled position had no way to know from the
 * brief alone that it wasn't the original entry. Only ever fires when `rollHistory.rollCount > 0`
 * (Largo C6 omission — a never-rolled position gets no line at all, never a fabricated "not
 * rolled" one). Cites the most recent roll only (the last two legs) — the full chain is a
 * separate concern (record.ts's own composite), not something to unpack bullet-by-bullet here.
 *
 * Second sentence added 2026-09-15 (live repro INTC:35): the brief's own headline P&L is
 * deliberately the TERMINAL leg's own exit P&L (play-brief-resolve.ts's `loadClosedPlay` avoids
 * the chain-composite override on purpose — see closed-plays.ts's header on the peak/composite
 * mismatch bug that protects against), so a rolled chain's real result — which can be materially
 * worse than the terminal leg alone (INTC: -33.2% terminal vs -60.47% compounded composite) — was
 * otherwise never visible anywhere in the brief. Cites ONLY `chainComposite`'s own scalar fields
 * as plain text; deliberately never blended with the terminal leg's price/peak/trough numbers in
 * the same clause, which is exactly the pairing that caused the original bug.
 */
/**
 * Extra calendar-day runway the most recent roll bought — `curr.expiry` minus `prev.expiry`,
 * both plain YYYY-MM-DD date-only strings (no ET-offset ambiguity, unlike `committedAt`). Null
 * when either expiry is missing/unparseable, or when the delta isn't POSITIVE — `roll-plan.ts`'s
 * own module header states the design intent plainly ("A ROLL BUYS TIME") and `buildRollChild`
 * hard-gates every live roll on `pick.dte > parentDte + buffer` (DEFAULT_MIN_ROLL_BUFFER_DAYS),
 * so a non-positive delta should never occur for a roll this function ever sees in production —
 * but a defensive null-honest floor costs nothing and protects a pre-gate historical chain leg
 * (or a malformed date) from ever printing a fabricated or backwards "extra days" claim.
 */
export function rollRunwayExtensionDays(
  prevExpiry: string | null,
  currExpiry: string | null,
): number | null {
  if (!prevExpiry || !currExpiry) return null;
  const prevMs = Date.parse(`${prevExpiry}T00:00:00Z`);
  const currMs = Date.parse(`${currExpiry}T00:00:00Z`);
  if (!Number.isFinite(prevMs) || !Number.isFinite(currMs)) return null;
  const days = Math.round((currMs - prevMs) / 86_400_000);
  return days > 0 ? days : null;
}

function rollHistoryLine(ctx: SwingPlayBriefContext): string | null {
  const rh = ctx.rollHistory;
  if (!rh || rh.rollCount <= 0 || rh.legs.length < 2) return null;
  const prev = rh.legs[rh.legs.length - 2]!;
  const curr = rh.legs[rh.legs.length - 1]!;
  const fmtLeg = (l: { strike: number | null; right: string | null }): string => {
    const rightWord = l.right === "P" ? "put" : l.right === "C" ? "call" : "contract";
    return l.strike != null ? `$${l.strike} ${rightWord}` : rightWord;
  };
  // Largo C1 (2026-09-15, Ask Largo standing mandate): `committedAt` is a bare TIMESTAMPTZ instant
  // with no ET labeling (db.ts stamps it via `.toISOString()`) — slicing its raw UTC calendar day
  // is exactly the anti-pattern `bar-session-date.ts`'s own header warns against, and inconsistent
  // with `siblingPositionsNote` (play-brief.ts) already using `etStampFromIso` for the identical
  // field. `etSessionDate` is the shared C1 helper every other ET calendar-date read in this
  // codebase goes through — no site-local reimplementation.
  const dateStr =
    curr.committedAt && !Number.isNaN(Date.parse(curr.committedAt))
      ? etSessionDate(Date.parse(curr.committedAt))
      : null;
  const times = rh.rollCount === 1 ? "once" : `${rh.rollCount} times`;
  // Ask Largo round 18 (2026-09-18): `expiry` has sat unread on every SwingRollHistoryLeg since the
  // roll-history disclosure shipped — the narrative named WHAT was rolled (strike/right) but never
  // WHY, i.e. the runway a roll exists to buy in the first place (see the module header on
  // `roll-plan.ts`: "A ROLL BUYS TIME... never roll flat/nearer"). Surfacing the day-count, not the
  // raw expiry dates, keeps this additive and terse rather than duplicating `fmtLeg`'s own strike
  // disclosure with a second date clause.
  const runwayDays = rollRunwayExtensionDays(prev.expiry, curr.expiry);
  const runwayClause = runwayDays != null ? `, buying **${runwayDays}d** of extra runway` : "";
  const rollSentence = `**Rolled ${times}** — most recently from the ${fmtLeg(prev)} to the ${fmtLeg(curr)}${dateStr ? ` on ${dateStr}` : ""}${runwayClause}.`;
  const composite = rh.chainComposite;
  if (!composite || composite.compoundedReturnPct == null) return rollSentence;
  const compoundedStr = `${composite.compoundedReturnPct >= 0 ? "+" : ""}${composite.compoundedReturnPct.toFixed(1)}%`;
  const worstStr = composite.worstLegPnlPct != null ? `${composite.worstLegPnlPct.toFixed(1)}%` : "n/a";
  return `${rollSentence} Full chain result: **${compoundedStr} compounded** (${composite.outcome}, worst leg ${worstStr}) — this leg's own exit P&L above is only part of the story.`;
}

function degradedReadLine(play: TerminalPlay, bucket: "watch" | "open" | "closed"): string | null {
  if (bucket === "closed") return null;
  const rec =
    swingActionDisplay(play)?.label ??
    play.recommendation ??
    play.swingEntryAction?.toUpperCase() ??
    "HOLD";
  const health = thesisHealthUncalibrated(play.thesisHealth) ? null : play.thesisHealth?.health;
  // Honest relative retracement (mfe-capture.ts), not point-difference — a 4TH call site with the
  // identical bug, found while fixing the other three (blast radius, FINDINGS 2026-09-10): this
  // degraded-read fallback (fires only when Vector spot isn't wired) independently computed
  // `peak - pnlPct` right beside actionNarrative's own copy of the same bug in this same file.
  // captureFloor=80 matches the sibling aside in play-brief-narrative-coaching.ts (a secondary
  // clause on an already-degraded line, not a standalone recommendation).
  const giveback = mfeCaptureOutcome(play.pnlPct, play.peak, null);
  // BUG FIX (2026-09-12): `actionNarrative` (above in this same file, ALWAYS called first in
  // `tradeManagerNarrativeSection` before this fallback ever runs) already unconditionally renders
  // "Round-tripped past breakeven — was up X% at peak, now Y%" whenever `giveback.kind ===
  // "round_trip"` — see its own `if (giveback?.kind === "round_trip")` block, which fires
  // regardless of `rec`. Both functions call the exact same pure `mfeCaptureOutcome(play.pnlPct,
  // play.peak, null)` on the exact same inputs, so they always agree on `giveback.kind` — meaning
  // this fallback (which only ever runs ALONGSIDE actionNarrative, never instead of it — see the
  // `spot == null` branch in tradeManagerNarrativeSection) restated an already-stated fact
  // verbatim. Live repro: CRWD OPEN/TRIM swing brief 2026-09-12 — "**Round-tripped past
  // breakeven** — was up **130%** at peak, now **-10%**" in the "Desk says TRIM" bullet, then
  // "round-tripped past breakeven — was up **130%** at peak, now **-10%**" again inside this very
  // function's "Live read" bullet. The section's own de-dup (`seen`, first-48-chars) never caught
  // it — same shape as the "Entry stance"/"Gates blocking entry" duplication this file's own
  // comment already documents fixing once, a case this is NOT the same call-site pair as.
  //
  // BUG FIX (2026-09-21, Ask Largo standing mandate): the `capture` branch's own comment (left
  // above until now) claimed "no live evidence of that case duplicating" for capturePct<75 — that
  // claim was never actually true. `giveback.capturePct < 80` here overlaps
  // `giveback.capturePct < 75` in actionNarrative's OWN capture branch (both read the identical
  // `mfeCaptureOutcome` result), so for ANY capturePct below 75 — not just the intended [75,80)
  // "genuinely new information" band — BOTH functions render a giveback line and the section's
  // `seen` de-dup can't catch it (the two lines open with different prose, "Desk says TRIM..." vs
  // "**Live read**...", so their first-48-char keys never match even though the embedded fact is
  // identical). Live repro: COIN SWING:COIN:1190 (committed, 2026-09-21 RTH) — pnlPct 115.2%,
  // peak 178.5% -> capturePct 64.54%, well under BOTH floors. Real served envelope's "Trade
  // manager read" section carried "Gave back **35%** of peak — consider protecting runner." in
  // the "Desk says TRIM" bullet AND "gave back **35%** from peak" again in the "Live read" bullet
  // three bullets later. Also reproduces off this file's own existing NRG fixture
  // (pnlPct=39.8, peak=132.7 -> capturePct 30%) in the "4th call site" test below, which only
  // asserted the Live-read text was present and never checked the sibling bullet for the
  // duplicate it was already emitting. Fix: restrict this bit to the [75,80) band the comment
  // always intended — the ONLY range where actionNarrative's own <75 branch does NOT already fire,
  // so this line is genuinely additive instead of an echo.
  const givebackBit =
    giveback?.kind === "capture" && giveback.capturePct >= 75 && giveback.capturePct < 80
      ? ` · gave back **${(100 - giveback.capturePct).toFixed(0)}%** from peak`
      : "";
  const healthBit = health != null ? ` · thesis **${health}%**` : "";
  // BUG FIX (2026-09-14, Ask Largo standing mandate, live repro RKLX/PGY OPEN briefs): this used to
  // gate purely on `play.mark != null`, which the TRUE entry-fallback case always satisfies — a
  // fresh banger-lane row with no synced quote yet carries `play.mark === play.entry`
  // (horizonPlayFromBangerPosition's fallback), not a real live price. RKLX rendered "mark
  // **$0.51**" here (the entry premium) in the SAME brief whose Position section, a few lines
  // above, correctly read "Mark: **unknown** _(sync quote, no live price yet — do not read as
  // flat)_" and whose own Data caveat said "mark not synced to live tape" — a specific dollar
  // figure presented as current right next to two honest disclosures that it isn't known. 3rd
  // instance of this exact root cause in this file/lane; the other two call sites (`pnlSection` in
  // play-brief.ts, the "Premium stop rail" cushion in play-brief-intel.ts) already gate on the
  // shared `optionMarkGenuinelyUnknown` (play-brief-absence.ts) — this call site never picked up
  // the same guard. Fix: omit the markBit entirely (never fabricate a "not shown" placeholder —
  // this whole line only fires when Vector spot isn't wired, so a missing markBit alongside a
  // present healthBit/givebackBit is expected, not a gap).
  const markBit =
    play.mark != null && !optionMarkGenuinelyUnknown(play) ? ` · mark **${fmtOptionUsd(play.mark)}**` : "";
  return `**Live read** — Vector spot not wired on this tick; desk still says **${rec}**${healthBit}${markBit}${givebackBit}. Levels refresh on next poll.`;
}

/** Largo-style trade manager narration — levels, flow, hold/break coaching. */
export function tradeManagerNarrativeSection(
  ctx: SwingPlayBriefContext,
  bucket: "watch" | "open" | "closed",
): RichSection | null {
  const { play } = ctx;
  const vec = vectorOf(ctx);
  // Ask Largo standing mandate, readMs-anchor sweep follow-up to #5351: this is the brief's main
  // narrative section, so a fresh wall-clock sample here (instead of ctx.readMs, the one canonical
  // "now" composeSwingPlayBrief stamps before any section runs) is exactly the risk the doc comment
  // on SwingPlayBriefContext.readMs warns about — a staleness verdict here disagreeing with a
  // sibling section over the SAME underlying field because compose does real sequential I/O between
  // sections and each bare Date.now() call can land on a different real instant.
  const readMs = ctx.readMs ?? Date.now();
  const vectorStale = vectorSnapshotStale(vec, readMs, ctx.sessionDate);
  const gex = ctx.ecosystem?.gex_positioning;
  const gexStale = gexMatrixStale(gex, readMs);
  // Null stale GEX spot at source — same Largo C2 class as walls/flip (#4401/#4411).
  const spot =
    fin(vectorStale ? undefined : vec?.spot) ?? fin(gexStale ? undefined : gex?.spot);

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
    const rollLine = rollHistoryLine(ctx);
    if (rollLine) add(rollLine);
    for (const line of collectCoachingBullets(ctx, bucket, spot)) add(line);
    if (!bullets.length) return null;
    return { title: "Trade manager read", body: bullets.join("\n"), bias: "neutral" };
  }

  const action = actionNarrative(play, bucket);
  if (action) add(action);

  const rollLine = rollHistoryLine(ctx);
  if (rollLine) add(rollLine);

  for (const line of collectCoachingBullets(ctx, bucket, spot)) add(line);

  if (spot != null) {
    const posture = dealerPostureLine(ctx, spot);
    if (posture) add(posture);
  } else {
    const degraded = degradedReadLine(play, bucket);
    if (degraded) add(degraded);
    // railsFallback is written as OPEN-position exit management ("bank trims into strength",
    // "honor stops on closing basis") -- it exists to cover the rare case where manageLifecycleCoaching
    // (bucket==="open" only) returns null despite a real exitPolicy (e.g. a contract string that
    // doesn't match the DTE regex). But its guard only checked "Manage plan" didn't already
    // render, not the bucket itself -- and manageLifecycleCoaching unconditionally returns null
    // for bucket==="watch", so that guard is ALWAYS true there, making this the WATCH-bucket path
    // in practice, not the rare-open-edge-case it was meant for. Live repro: SKHY WATCH brief,
    // 2026-09-14, thesis already INVALIDATED pre-entry (never traded), rendered "Manage rails --
    // trim ladder +100%. Honor stops on closing basis; bank trims into strength" -- exit-management
    // guidance for a position that was never entered and never will be. Restricting to
    // bucket==="open" removes the wrong WATCH-bucket firing while preserving the genuine open-only
    // fallback it was designed for.
    if (bucket === "open" && !bullets.some((b) => /Manage plan/i.test(b))) {
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
        add(narrateMagnet(level, resolveGammaPosture(ctx, vec)));
        used.add("magnet");
      } else if (level.kind === "king" && !used.has("king")) {
        add(narrateKing(level, resolveGammaPosture(ctx, vec)));
        used.add("king");
      } else if (level.kind === "max_pain" && !used.has("max_pain")) {
        add(narrateMaxPain(level, spot, resolveGammaPosture(ctx, vec)));
        used.add("max_pain");
      } else if (level.kind === "gamma_flip" && !used.has("gamma_flip") && Math.abs(level.distancePct) < 3) {
        add(narrateFlip(level, play, spot));
        used.add("gamma_flip");
      }
    }

    const vectorLive = !vectorStale;
    const prox = vec?.proximity;
    if (vectorLive && prox?.callout && bullets.length < MAX_BULLETS) {
      add(`**Nearest wall ${fmtPriceLevel(prox.strike)}** (${prox.side}) — ${prox.callout}`);
    }

    const walls = vec?.wallEvents ?? [];
    if (vectorLive && walls[0] && bullets.length < MAX_BULLETS) {
      const w = walls[walls.length - 1]!;
      add(`**Wall just moved** — ${w.kind.replace(/_/g, " ")}: ${w.message}`);
    }
  }

  const flow = flowNarrative(ctx, play);
  if (flow && !bullets.some((b) => /HELIX tape/i.test(b))) add(flow);

  const gexForFlip = ctx.ecosystem?.gex_positioning;
  const vecFlipRaw = vectorStale ? undefined : vec?.gammaFlip;
  const flipRaw = fin(vecFlipRaw) ?? fin(gexForFlip?.flip);
  const flipFromStaleGex =
    vecFlipRaw == null && gexForFlip?.flip != null && gexMatrixStale(gexForFlip, readMs);
  const flip = flipFromStaleGex ? null : flipRaw;
  const focal = spot != null ? collectFocalLevels(ctx, spot) : [];
  // BUG FIX (2026-09-19, Ask Largo standing mandate, sibling of #5253): this call site was NOT
  // updated by #5253's preEntry fix, and #5253's own PR body's claim that this function is
  // "OPEN-only in production" does not hold structurally -- play-brief-intel.ts's real caller
  // passes the live `bucket` straight through (`tradeManagerNarrativeSection(ctx, bucket)`), and
  // only bucket==="closed" short-circuits before reaching this line; "watch" falls through to here
  // exactly like "open" does. Confirmed live: GET /api/market/swing/play-brief for a WATCH play
  // showed the top-level envelope.invalidation field (resolveBreakInvalidation, fixed by #5253)
  // correctly saying "this setup is no longer live -- skip it", while this "Trade manager read"
  // narrative bullet -- built from the exact same breakTrigger() -- still said "exit or cut size"
  // for the same play. Mirrors resolveBreakInvalidation's own preEntry derivation: only
  // OPEN/HOLD/TRIM hold a position to exit/cover; watch/committed-but-not-yet-open is pre-entry.
  const breakPreEntry = play.status !== "OPEN" && play.status !== "HOLD" && play.status !== "TRIM";
  let breakLine = spot != null ? breakTrigger(play, focal, flip, breakPreEntry) : null;
  // BUG FIX (2026-09-15, Ask Largo standing mandate, forensic batch 33, live repro NN#32): a
  // swing play is always LONG PREMIUM (a bought call for LONG, a bought put for SHORT — see
  // executableFill's own doc comment, terminal-ladder.ts), so it is always SOLD into the BID to
  // exit — `play.execMark` (the bid) is the honest exit fill regardless of direction. This
  // fallback "Break watch" line only ever framed the stop as a FUTURE risk ("lose premium stop
  // $X -> cut size or exit"), even when the bid was already AT or THROUGH the stop right now.
  // The fact that the executable side has already breached the stop DID already exist elsewhere
  // in the brief (watchForSection's "no real cushion on the executable side" note, play-brief-
  // intel.ts) but only as a footnote in a reference section, never in this reserved,
  // always-surfaced bullet that IS the brief's actual risk headline. A member trusting "HOLD" at
  // the top could easily miss that their real exit is already past the intended risk line.
  const execStop = play.exitPolicy?.stop_premium;
  const execBreached = execStop != null && play.execMark != null && play.execMark <= execStop;
  if (!breakLine && play.direction === "LONG" && execStop != null) {
    breakLine = execBreached
      ? `**Break watch — stop already breached on the executable side** — bid **${fmtOptionUsd(play.execMark)}** is at/through your premium stop **${fmtOptionUsd(execStop)}** right now → exit or cut size.`
      : `**Break watch** — lose premium stop **${fmtOptionUsd(execStop)}** → cut size or exit.`;
  } else if (!breakLine && play.direction === "SHORT" && execStop != null) {
    breakLine = execBreached
      ? `**Break watch — stop already breached on the executable side** — bid **${fmtOptionUsd(play.execMark)}** is at/through your premium stop **${fmtOptionUsd(execStop)}** right now → exit or cut size.`
      : `**Break watch** — reclaim **${fmtOptionUsd(execStop)}** → cover shorts.`;
  }
  if (breakLine) add(breakLine, { reserved: true });

  // crossDeskCoaching (collected into `bullets` above via collectCoachingBullets) already names
  // the same Vector headline when desks conflict — see counterThesisLine's own doc comment.
  // BUG FIX (2026-09-22, Ask Largo standing mandate): the sibling dedup check in
  // play-brief-narrative-coaching.ts's `composeCoachingBullets` had the identical bug — this regex
  // only matched Vector-as-LEAD-conflict phrasing ("Vector bearish (...)"), not Vector-as-demoted-
  // "rest"-conflict phrasing ("Vector also reads bearish (...)"), which renderCrossDeskConflict
  // produces whenever another desk (today: only HELIX, on a FLOW_ACCUMULATION archetype) outranks
  // Vector's own weight. See that file's matching fix comment for the full mechanism + regression
  // test.
  const vectorConflictAlreadyNoted = bullets.some((b) => /Vector (?:also reads )?(bearish|bullish)/.test(b));
  const counter = counterThesisLine(ctx, play, spot, vectorConflictAlreadyNoted);
  if (counter) add(counter, { reserved: true });

  if (!bullets.length) return null;

  // Bias reads the chart evidence (same majority vote as chartTechnicalsSection), not the play's
  // LONG/SHORT direction — a SHORT into a bullish tape must not badge bearish (FINDINGS 2026-09-06).
  const vectorLive = !vectorStale;
  const bias =
    vectorLive && vec?.technicals != null
      ? technicalsBias(vec.technicals, spot)
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
      meta: `${level.pct.toFixed(0)}% of DP volume · ${fmtFlowUsd(level.premium)}`,
      distancePct: distPct(spot, level.strike),
    },
    { direction } as TerminalPlay,
    spot,
  );
}
