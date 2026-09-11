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
  gexMatrixStale,
  vectorSnapshotStale,
  resolveGammaPosture,
  nighthawkLiveForSession,
  zerodteLiveForSession,
} from "./play-brief-absence";
import type { VectorFullState } from "@/lib/bie/vector-full-state";
import type { VectorFreshnessBlock } from "@/lib/bie/vector-state-freshness";
import type { VectorDarkPoolLevel } from "@/features/vector/lib/vector-dark-pool-levels";
import { collectCoachingBullets } from "./play-brief-narrative-coaching";
import { fmtPremium } from "@/lib/fmt-money";
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

/** For a PER-CONTRACT option premium (live mark, stop/target rails) — these are typically
 *  single/low-double-digit dollars where cents are the difference between a stop and a hold.
 *  `fmtUsd`'s whole-dollar rounding was reused here for a while and it produced literal
 *  contradictions within one brief: the Position section's precise "Mark: +$9.70" (2-decimal,
 *  from play-brief.ts's own fmtUsd) sat beside this file's "Break watch — lose premium stop $2"
 *  and "Live read — mark $10" (both rounded from $1.96 / $9.70) — same underlying number,
 *  two different values on the same page. Matches play-brief.ts's fmtUsd exactly on purpose so
 *  the whole brief renders one number for one fact.
 *
 *  BUG FIXED 2026-09-09 (blast radius of the play-brief.ts fmtUsd fix, same session/PR): every
 *  call site here — live mark, the railsFallback stop/target, and the break-watch stop_premium —
 *  is the same ABSOLUTE per-contract PRICE class play-brief.ts's fmtUsd was fixed for (never a
 *  signed delta), so this file's copy carried the exact same "+" defect play-brief.ts just had
 *  removed. Left unfixed, it would have made the fix WORSE: the Position section would read the
 *  correct sign-free "$1.95" while this file's Trade manager narrative kept "+$1.95" for the
 *  identical field in the same document — a fresh cross-section contradiction of the same kind
 *  the doc comment above already warns about. */
function fmtOptionUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

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

  const readMs = Date.now();
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
  const readMs = Date.now();
  const posture = resolveGammaPosture(ctx, vec);
  const vectorStale = vectorSnapshotStale(vec, readMs, ctx.sessionDate);
  const vecFlip = vectorStale ? undefined : vec?.gammaFlip;
  const flipFromStaleGex = vecFlip == null && gex?.flip != null && gexMatrixStale(gex, readMs);
  const flip = flipFromStaleGex ? null : (vecFlip ?? gex?.flip ?? null);

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

  const vecAgeMs = vec?.dataAgeMs;
  const snapshotStale = vectorStale;
  const snapshotAgeMs = vectorStale ? vecAgeMs : null;
  const lead = snapshotStale
    ? `**Last snapshot**${snapshotAgeMs != null ? ` (~${Math.round(snapshotAgeMs / 1000)}s old)` : ""}`
    : "**Right now**";

  return `${lead} — spot **${spot.toFixed(2)}** · ${mechanic}${flipBit}`;
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
        : "pin gravity depends on dealer gamma posture (not resolved on this read) — treat as a level to watch, not a settled pin.";
  return `**Max pain ${level.price.toFixed(2)}** (${fmtPct(level.distancePct)} ${pull} spot) — ${gravity}`;
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
    `**HELIX tape** (${flow.window_hours}h) — **${bias}** · calls ${fmtFlowUsd(flow.call_premium)} · puts ${fmtFlowUsd(flow.put_premium)} · ${flow.print_count} prints.`;

  if (alignedLong) tape += " Flow stepping in on the call side **supports** the long swing.";
  else if (alignedShort) tape += " Put flow **aligns** with the short thesis.";
  else if (conflict) tape += " Flow **conflicts** with swing direction — size down until tape agrees.";

  const anomaly = ctx.ecosystem?.recent_anomalies?.[0];
  if (anomaly) {
    tape += ` Latest anomaly: **${anomaly.anomaly_type}** — ${anomaly.detail}.`;
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
): string {
  switch (reason) {
    case "expiry_risk":
      return " — time-based: DTE nearing the lane's theta cliff (thesis still intact)";
    case "structural_stop":
    case "thesis_stop":
      return " — thesis broke";
    case "premium_stop":
      return " — premium stop hit";
    case "catalyst_shift":
      return " — catalyst shifted against the thesis";
    case "regime_shift":
      return " — regime shifted against the thesis";
    case "time_stop":
      return " — time stop hit";
    default:
      // No manage-sync rung yet — fall back to the spot-detected structural break when that's
      // what actually drove the EXIT (structuralBreakFromSpot in live-plays.ts), otherwise say
      // nothing rather than guess at a mechanism the data doesn't actually confirm.
      return thesisLevel?.level === "break" ? " — thesis broke" : "";
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
    lines.push(
      `**Desk says TRIM**${next ? ` — next rail at **+${next.trigger_pct}%**` : ""}.` +
        (giveback?.kind === "round_trip" ? "" : " Bank partial into strength; don't give back peak.") +
        (trimsFired === 0
          ? " Nothing's banked yet — this is advisory only; place the trim yourself, the desk does not execute trades."
          : ""),
    );
  } else if (rec === "SELL") {
    lines.push(`**Exit now**${sellReasonClause(play.manageReason, play.thesisBreak)}. Flatten per manage engine.`);
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
      `**Round-tripped past breakeven** — was up **${giveback.peakPct.toFixed(0)}%** at peak, now **${giveback.exitPnlPct.toFixed(0)}%** — consider protecting what's left.`,
    );
  } else if (giveback?.kind === "capture" && giveback.capturePct < 75) {
    lines.push(
      `Gave back **${(100 - giveback.capturePct).toFixed(0)}%** of peak — consider protecting runner.`,
    );
  }

  return lines.join(" ");
}

function breakTrigger(play: TerminalPlay, focal: FocalLevel[], flip: number | null): string | null {
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
  const support = focal.find(
    (l) => (l.kind === "put_wall" || l.kind === "dark_pool") && l.distancePct < 0,
  )?.price;
  const resist = focal.find((l) => l.kind === "call_wall" && l.distancePct > 0)?.price;

  if (play.direction === "LONG") {
    const flipBelowSpot = flip != null && focal.some((l) => l.kind === "gamma_flip" && l.distancePct < 0);
    const stop = support ?? (flipBelowSpot ? flip : null);
    if (stop != null) {
      return `**Break watch** — lose **${stop.toFixed(2)}** on a closing basis → structural support failed; exit or cut size.`;
    }
  } else if (play.direction === "SHORT" && resist != null) {
    return `**Break watch** — reclaim **${resist.toFixed(2)}** → resistance broken; cover shorts.`;
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
  const readMs = Date.now();
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
  return breakTrigger(play, focal, flip);
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
  if (!vectorSnapshotStale(vec, Date.now(), ctx.sessionDate) && !vectorConflictAlreadyNoted) {
    if (play.direction === "LONG" && vp?.bias === "short") {
      reasons.push(`Vector bearish (${vp.headline ?? vp.grade ?? "desk read"})`);
    } else if (play.direction === "SHORT" && vp?.bias === "long") {
      reasons.push(`Vector bullish (${vp.headline ?? vp.grade ?? "desk read"})`);
    }
  }

  if (spot != null) {
    const gexForWalls = eco?.gex_positioning;
    const vectorStaleForWalls = vectorSnapshotStale(vec, Date.now(), ctx.sessionDate);
    const vecCallWall = vectorStaleForWalls ? undefined : vec?.gexWalls?.callWalls?.[0]?.strike;
    const vecPutWall = vectorStaleForWalls ? undefined : vec?.gexWalls?.putWalls?.[0]?.strike;
    const callWall = vecCallWall ?? gexForWalls?.call_wall ?? null;
    const putWall = vecPutWall ?? gexForWalls?.put_wall ?? null;
    // Same Largo C2 gap #4355/#4360 fixed for dealer posture: a wall level cited from the GEX-only
    // fallback (no live Vector wall) can be from a stale matrix — steelmanning "call wall overhead"
    // off a stale snapshot is the same dishonesty as "dealers long gamma" off one. Gated per-wall,
    // not both-or-nothing, since one side can come from a live Vector read while the other falls
    // back to stale GEX.
    const gexStaleForWalls = gexMatrixStale(gexForWalls, Date.now());
    const callWallFromStaleGex = vecCallWall == null && gexForWalls?.call_wall != null && gexStaleForWalls;
    const putWallFromStaleGex = vecPutWall == null && gexForWalls?.put_wall != null && gexStaleForWalls;
    if (play.direction === "LONG" && callWall != null && callWall > spot && !callWallFromStaleGex) {
      const d = distPct(spot, callWall);
      if (d < 3) reasons.push(`call wall **${callWall.toFixed(2)}** overhead (${d.toFixed(1)}%)`);
    }
    if (play.direction === "SHORT" && putWall != null && putWall < spot && !putWallFromStaleGex) {
      const d = Math.abs(distPct(spot, putWall));
      if (d < 3) reasons.push(`put wall **${putWall.toFixed(2)}** below (${d.toFixed(1)}%)`);
    }
  }

  const vectorStale = vectorSnapshotStale(vec, Date.now(), ctx.sessionDate);
  const ema = !vectorStale ? vec?.technicals?.emaStack ?? null : null;
  if (play.direction === "LONG" && ema === "down") reasons.push("bear EMA stack on chart");
  if (play.direction === "SHORT" && ema === "up") reasons.push("bull EMA stack on chart");

  const gex = eco?.gex_positioning;
  const vecPosture = !vectorStale ? vec?.regime?.posture ?? null : null;
  const posture = vecPosture ?? gex?.gamma_posture ?? null;
  const postureFromGex = !vecPosture && gex?.gamma_posture;
  const skipGexPosture = postureFromGex && gexMatrixStale(gex, Date.now());
  if (!skipGexPosture) {
    if (play.direction === "LONG" && posture === "long") reasons.push("dealer long-gamma pins rallies");
    if (play.direction === "SHORT" && posture === "short") reasons.push("dealer short-gamma can squeeze shorts");
  }

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
  return `**Counter-thesis (${side} case)** — ${reasons.slice(0, 3).join(" · ")}. If this wins, honor invalidation — don't hope.`;
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
  const givebackBit =
    giveback?.kind === "round_trip"
      ? ` · round-tripped past breakeven — was up **${giveback.peakPct.toFixed(0)}%** at peak, now **${giveback.exitPnlPct.toFixed(0)}%**`
      : giveback?.kind === "capture" && giveback.capturePct < 80
        ? ` · gave back **${(100 - giveback.capturePct).toFixed(0)}%** from peak`
        : "";
  const healthBit = health != null ? ` · thesis **${health}%**` : "";
  const markBit = play.mark != null ? ` · mark **${fmtOptionUsd(play.mark)}**` : "";
  return `**Live read** — Vector spot not wired on this tick; desk still says **${rec}**${healthBit}${markBit}${givebackBit}. Levels refresh on next poll.`;
}

/** Largo-style trade manager narration — levels, flow, hold/break coaching. */
export function tradeManagerNarrativeSection(
  ctx: SwingPlayBriefContext,
  bucket: "watch" | "open" | "closed",
): RichSection | null {
  const { play } = ctx;
  const vec = vectorOf(ctx);
  const readMs = Date.now();
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
        add(narrateMagnet(level, resolveGammaPosture(ctx, vec)));
        used.add("magnet");
      } else if (level.kind === "king" && !used.has("king")) {
        add(narrateKing(level, resolveGammaPosture(ctx, vec)));
        used.add("king");
      } else if (level.kind === "max_pain" && !used.has("max_pain")) {
        add(narrateMaxPain(level, spot, resolveGammaPosture(ctx, vec)));
        used.add("max_pain");
      } else if (level.kind === "gamma_flip" && !used.has("gamma_flip") && Math.abs(level.distancePct) < 3) {
        add(narrateFlip(level, play));
        used.add("gamma_flip");
      }
    }

    const vectorLive = !vectorStale;
    const prox = vec?.proximity;
    if (vectorLive && prox?.callout && bullets.length < MAX_BULLETS) {
      add(`**Nearest wall ${prox.strike.toFixed(2)}** (${prox.side}) — ${prox.callout}`);
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
  let breakLine = spot != null ? breakTrigger(play, focal, flip) : null;
  if (!breakLine && play.direction === "LONG" && play.exitPolicy?.stop_premium != null) {
    breakLine = `**Break watch** — lose premium stop **${fmtOptionUsd(play.exitPolicy.stop_premium)}** → cut size or exit.`;
  } else if (!breakLine && play.direction === "SHORT" && play.exitPolicy?.stop_premium != null) {
    breakLine = `**Break watch** — reclaim **${fmtOptionUsd(play.exitPolicy.stop_premium)}** → cover shorts.`;
  }
  if (breakLine) add(breakLine, { reserved: true });

  // crossDeskCoaching (collected into `bullets` above via collectCoachingBullets) already names
  // the same Vector headline when desks conflict — see counterThesisLine's own doc comment.
  const vectorConflictAlreadyNoted = bullets.some((b) => /Vector (bearish|bullish)/.test(b));
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
