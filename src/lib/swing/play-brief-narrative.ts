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
  gexMatrixAgeMs,
  gexMatrixStale,
  vectorSnapshotStale,
  darkPoolStale,
  resolveGammaPosture,
  nighthawkLiveForSession,
  zerodteLiveForSession,
  optionMarkGenuinelyUnknown,
  optionMarkStaleCaveat,
} from "./play-brief-absence";
import { etSessionDate } from "@/lib/largo/temporal/bar-session-date";
import type { VectorFullState } from "@/lib/bie/vector-full-state";
import type { VectorFreshnessBlock } from "@/lib/bie/vector-state-freshness";
import type { VectorDarkPoolLevel } from "@/features/vector/lib/vector-dark-pool-levels";
import { collectCoachingBullets } from "./play-brief-narrative-coaching";
import { fmtOptionUsd, fmtPct, fmtPremium, fmtPriceLevel } from "@/lib/fmt-money";
import { formatDealerDollars } from "./format-nonzero";
import { technicalsBias } from "./play-brief-technicals";
import { thesisHealthUncalibrated } from "./thesis-health";
import { mfeCaptureOutcome } from "./mfe-capture";
import { isSwingPlayStaleCheckExempt } from "./entry-enterability";
import { swingVerdictVerb } from "./play-brief";

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
//
// Percentage/distance formatting is `fmtPct`, imported from @/lib/fmt-money above — this file
// previously carried its own byte-identical copy of the exact same rounding-mismatch bug
// `fmtOptionUsd` documents, just never caught because it was percentages, not dollars (fixed
// 2026-10-08 — see fmt-money.ts's `fmtPct` header for the live repro).

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

  // BUG FIX (2026-10-06): dark-pool levels used to inherit ONLY the whole-state `vectorStale` gate
  // above, which answers "how old is the overall compute" — not "how old is THIS field's own cache
  // entry" (the dark-pool cache is warmed on its own looser ~10min/25min-TTL cadence; see
  // vector-absent-sections.ts's `dark_pool_stale`). Omit the level when it is, same discipline as
  // every other stale-gated level here, rather than silently citing a cache entry that can be 20+
  // minutes old as if it were current — live trigger: vector-dark-pool-warm failing heavily in prod.
  const dpStale = darkPoolStale(vec);
  for (const dp of (vec?.darkPoolLevels ?? []).slice(0, 3)) {
    if (vectorStale || dpStale) break;
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

function dealerPostureLine(
  ctx: SwingPlayBriefContext,
  spot: number,
  bucket: "watch" | "open" | "closed",
): string | null {
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
    // Ask Largo standing mandate (2026-10-15): live repro GOOG, posture unresolved
    // (flip_reason=crossings_far_from_spot — the book's one crossing sits ~12.6% from spot, just
    // outside the ±12% plausibility window cumulativeGammaFlipDetail uses to call a stable flip).
    // gex-positioning.ts's own field doc for flip_nearest says it is "[a]lso populated when flip
    // is null because every crossing sits outside the ... plausibility window: it names the
    // closest crossing even when it was rejected as the headline flip" — this branch used to
    // discard that specific, already-computed level and fall back to a bare "not resolved"
    // message. Gated on gexMatrixStale the same way fragileBit below is: a stale matrix's
    // crossing location is exactly as unreliable as its flip.
    //
    // BUG FIX (2026-10-17, Ask Largo standing mandate, live repros RDDT/SOFI): `gex.
    // distance_to_nearest_flip_pct` is computed in gex-positioning.ts as (spot - flip) / spot —
    // positive when the level is BELOW spot. Every other level in this same brief (gamma magnet,
    // call/put wall, confluence) is phrased via this file's own `distPct(spot, level)` — the exact
    // opposite convention, positive when the level is ABOVE spot. Rendering the raw field directly
    // here put the sign backwards relative to every sibling "X% away"/"X% from spot" line in the
    // same document. Live repro: RDDT spot 155.20, flip_nearest 229.60 (47.9% ABOVE spot) rendered
    // "(-47.9% away)" next to a sibling "Gamma magnet 177.01 (+14.1% from spot)" in the identical
    // brief. Recomputing via the file's own `distPct` (rather than just negating the raw field)
    // keeps this call site on the one sign convention the rest of the file already uses.
    const nearestCrossingBit =
      gex?.flip_nearest != null && !gexMatrixStale(gex, readMs)
        ? ` — chain's only crossing sits at **${fmtPriceLevel(gex.flip_nearest)}**${
            gex.distance_to_nearest_flip_pct != null
              ? ` (${fmtPct(distPct(spot, gex.flip_nearest))} away)`
              : ""
          }, too far from spot to call a stable regime`
        : "";
    return `Spot **${fmtPriceLevel(spot)}** — dealer gamma posture not resolved on this read${nearestCrossingBit}.`;
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

  // Ask Largo standing mandate (2026-10-14): parity fix for PR #5994's VEX/DEX/CHARM additions to
  // gexPostureSection (play-brief-intel.ts) — collapseRedundantIntelSections
  // (play-brief-intel-collapse.ts) drops the WHOLE "GEX posture" section for OPEN/WATCH buckets
  // whenever this narrative is present, under a "folded into Trade manager read" note, but this
  // line never actually carried any vanna/dex/charm content — the VEX/DEX/CHARM fields silently
  // vanished rather than folding into anything. Same interpretive-read pattern as `mechanic`
  // above: a qualitative regime READ, not the raw $ figure (net_gex's own dollar value is likewise
  // never narrated here, by design — gexPostureSection's `Net GEX: **$NM**` line is the one place
  // for the number; this line is the one place for the "what it means" read). Gated on the SAME
  // `gexMatrixStale` check gexPostureSection uses for these fields — a stale matrix's regime reads
  // are exactly as unreliable here as there.
  const gexStale = gexMatrixStale(gex, readMs);

  // Ask Largo standing mandate (2026-10-15): gex-positioning.ts computes flip_crossings/
  // flip_nearest/distance_to_nearest_flip_pct unconditionally for every ticker/brief
  // ("the regime is more fragile than the single flip implies... read flip_nearest/
  // distance_to_nearest_flip_pct before calling [flip] a comfortable distance from flipping")
  // but this narrative line only ever cited the single stable `flip` above -- "a flip about to
  // re-cross" is a genuinely different risk shape than "a stable flip", so it earns its own
  // clause rather than silently riding inside flipBit. Raised on PR #4076 (comment 6175832614,
  // 2026-10-14); implemented here after ~22h with no reply, per this same thread's established
  // NEVER-SIT-IDLE precedent (comment 6168890076: implement after a reasonable wait rather than
  // block indefinitely on a design-call reply). Gated on the same gexStale check as the sibling
  // regime reads below -- a stale matrix's crossing count is as unreliable as its flip.
  // BUG FIX (2026-10-17, Ask Largo standing mandate, live repros RDDT/SOFI): same sign-inversion
  // fix as nearestCrossingBit above — `gex.distance_to_nearest_flip_pct` uses the opposite
  // "spot relative to level" sign convention from this file's own `distPct(spot, level)`, used by
  // every sibling level in the brief. Recompute via `distPct` rather than negate the raw field.
  const fragileBit =
    !gexStale && gex?.flip_crossings != null && gex.flip_crossings > 1 && gex?.flip_nearest != null
      ? ` · fragile flip — nearer crossing **${fmtPriceLevel(gex.flip_nearest)}**${
          gex.distance_to_nearest_flip_pct != null
            ? ` (${fmtPct(distPct(spot, gex.flip_nearest))} away)`
            : ""
        }`
      : "";

  const regimeBits = [
    !gexStale && gex?.vanna_regime_read ? `vanna: ${gex.vanna_regime_read}` : null,
    !gexStale && gex?.dex_regime_read ? `delta: ${gex.dex_regime_read}` : null,
    !gexStale && gex?.charm_regime_read ? `charm: ${gex.charm_regime_read}` : null,
  ].filter((bit): bit is string => bit != null);
  const regimeBit = regimeBits.length ? ` · ${regimeBits.join(" · ")}` : "";

  // Ask Largo standing mandate (2026-10-14, Largo deep-dive #2): same parity-fix class as the
  // regimeBit fix above — gexPostureSection's `Net GEX: **$NM**` and `Underlying session: **pct%**`
  // lines are ALSO content the "GEX posture" section's "folded into Trade manager read above" note
  // (play-brief-intel-collapse.ts) claims this bullet replaced, but neither was ever narrated here
  // either. Unlike the gamma-posture/VEX/DEX/CHARM qualitative reads, net_gex is itself the specific
  // $ figure the contract's precision principle (C9) asks for — appending it keeps this the one
  // place a member sees "why" dealers are long/short gamma without `expandIntel=1`. change_pct is
  // likewise never duplicated anywhere else in the narrative. Nearest-wall distance is NOT added
  // here — collectFocalLevels/narrateWall already narrate the nearest call/put wall from the same
  // vector-first/GEX-fallback precedence elsewhere in this section, so that content is genuinely
  // (if differently-framed) covered already.
  // BUG FIX (Ask Largo standing mandate, 2026-10-14): a large net GEX (SPY/SPX-scale tickers
  // routinely clear 1B+) rendered as e.g. "-17545.3M" under a fixed /1e6-then-"M" format —
  // formatDealerDollars picks M/B/T by magnitude instead, so this reads "-17.5B". See its header
  // for the live GOOGL/TSLA/AAPL/SPY repro (net CHARM is the most extreme case, but net GEX hits
  // the same defect on index-scale tickers).
  const netGexBit =
    !gexStale && gex?.net_gex != null
      ? ` · net GEX **${formatDealerDollars(gex.net_gex)}**`
      : "";
  const sessionChangeBit =
    !gexStale && gex?.change_pct != null ? ` · session **${fmtPct(gex.change_pct)}**` : "";

  // BUG FIX (Ask Largo standing mandate, 2026-10-14, live AMD repro): dealerPostureLine is a FOURTH
  // call site reading the same "is today's live desk state current" fact `isSwingPlayStaleCheckExempt`
  // was extracted (2026-10-07) to guard — degradedReadLine (this file, below) already gates on it,
  // but this sibling function never was. A dead-but-not-closed WATCH play (setupState EXTENDED /
  // entryStatus EXTENDED_CHASE) with a spot resolved via the GEX-matrix fallback (gexMatrixStale
  // false) while Vector's own snapshot is stale rendered "**Last snapshot** (~7209s old) — spot
  // **570.18** · dealers **short gamma**..." in the SAME envelope whose `confidence.why` read "Every
  // live source this brief reads from resolved cleanly this cycle" and `unavailableSources: []` —
  // the exact structured-chip-vs-free-text contradiction #5620 fixed twice already for sibling call
  // sites, recurring here because this one was never updated. A dead WATCH candidate has nothing
  // left to refresh, so "Last snapshot (~Ns old)" implies an active polling cadence that no longer
  // applies — gate on the shared predicate exactly like degradedReadLine does, rather than inventing
  // a fourth local check.
  const staleCheckExempt = bucket === "watch" && isSwingPlayStaleCheckExempt(ctx.play);
  const snapshotStale = vectorStale && !staleCheckExempt;
  // BUG FIX (2026-10-21, Ask Largo standing mandate, live TSLA WATCH repro): this caption used to
  // always age itself off `vec?.dataAgeMs` whenever Vector was stale — but every other value this
  // bullet renders (posture via resolveGammaPosture, flip, fragileBit/regimeBits/netGexBit/
  // sessionChangeBit above, even `spot` itself per tradeManagerNarrativeSection's own vector-then-
  // GEX fallback) ALREADY requires its own source to be non-stale before it's allowed to render —
  // vector when `!vectorStale`, GEX otherwise (resolveGammaPosture falls through to
  // `gex.gamma_posture` only when `!gexMatrixStale`; the regime/net/session bits above are
  // explicitly gated on `!gexStale`). So whenever `vectorStale` is true and we reach this line at
  // all, EVERY field just rendered is GEX-sourced and GEX-fresh by construction — captioning it
  // with Vector's (much older) age reports an age that has nothing to do with the data on screen.
  // Live repro: TSLA WATCH showed "Last snapshot (~10659s old) ... net GEX 422.1M · session
  // +1.8%" while the SAME envelope's evidence[] attributed that identical GEX reading to an 80s-
  // old read. Caption with GEX's own age instead (matching the sibling `gexPostureSection`'s
  // established "Last snapshot" pattern, play-brief-intel.ts) whenever the content is GEX-sourced.
  // `snapshotStale` is `vectorStale && !staleCheckExempt`, so whenever it's true, `vectorStale` is
  // already true too — content is GEX-sourced (never Vector's own age) by the proof above.
  const snapshotAgeLabel = snapshotStale ? ageSecondsLabel(gexMatrixAgeMs(gex, readMs)) : null;
  const lead = snapshotStale
    ? `**Last snapshot**${snapshotAgeLabel != null ? ` (~${snapshotAgeLabel} old)` : ""}`
    : "**Right now**";

  // BUG FIX (2026-10-21, Ask Largo standing mandate, live TSLA/CRWV WATCH repros): the age fix just
  // above (PR #6437) corrected the NUMBER this bullet captions itself with once Vector is stale and
  // its content is substituted from GEX, but never named GEX as the source of that content. Every
  // sibling "Last snapshot" usage elsewhere in the brief family (play-brief-intel.ts's
  // `gexPostureSection`/`vectorDeskSection`/etc.) appends an explicit disambiguating clause —
  // "— dealer posture may lag spot" when the content is GEX-sourced, "— Vector desk read may lag
  // spot" when it's Vector's own stale read — precisely so a reader can tell which feed a given
  // bullet comes from. This bullet always sits directly below `dataHonestyCoaching`'s own
  // "Data caveat — Vector Ns stale" bullet in the same "Trade manager read" section, and without a
  // source label of its own it reads as a contradiction: "Vector 8642s stale" immediately followed
  // by "Last snapshot (~72s old)" in the SAME list, as if Vector mysteriously refreshed between two
  // adjacent bullets. Each number was individually correct (confirmed against the GEX matrix's own
  // age) — the defect was purely the missing source label. Reusing `gexPostureSection`'s own exact
  // phrase (this bullet's content is, after all, the same dealer-posture read that section narrates
  // from GEX) rather than inventing new wording. Scoped to the `snapshotStale` branch only — the
  // non-substituted Vector-fresh ("Right now") branch's wording is unchanged.
  const sourceClauseBit = snapshotStale ? " — dealer posture may lag spot" : "";

  return `${lead} — spot **${fmtPriceLevel(spot)}** · ${mechanic}${flipBit}${fragileBit}${regimeBit}${netGexBit}${sessionChangeBit}${sourceClauseBit}`;
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

  // GAP FOUND (Ask Largo standing mandate, 2026-10-24): this file's own convention — every level
  // a member is told to watch states its distance from spot, "(X% from spot)" — already covers
  // narrateWall/narrateMaxPain/narrateMagnet (all a few lines below) but silently skipped this
  // one, narrateKing, and narrateFlip. `level.distancePct` is the identical already-computed field
  // those three already read; nothing new to compute, just applying the same line everyone else
  // in this file already has.
  return (
    `**Watch ${fmtPriceLevel(level.price)}** (${fmtPct(level.distancePct)} from spot) — major **dark pool** print (${level.meta ?? "institutional block"}). ` +
    `Institutions stacked here; treat as **${side}**. ${hold.charAt(0).toUpperCase()}${hold.slice(1)}.`
  );
}

// CLEANUP (Ask Largo standing mandate, 2026-10-15): this used to take a `spot` parameter like its
// siblings (narrateDarkPool/narrateMaxPain/narrateFlip, which all genuinely compare against it) —
// but every branch here reads only `level.distancePct`/`level.price` (the signed distance already
// computed from spot elsewhere), and `spot` itself was never referenced in the function body. Most
// likely leftover from the 2026-10-14 BUG FIX above, which rewrote the `breached` logic to use
// `distancePct`'s sign instead of a fresh spot comparison. No tsconfig `noUnusedParameters` catches
// this at build time, so it survived; removed rather than left as unused cruft (both call sites
// updated, no behavior change).
function narrateWall(level: FocalLevel, play: TerminalPlay): string {
  const isCall = level.kind === "call_wall";
  const near = Math.abs(level.distancePct) < 1.5;
  const verb = isCall ? "caps upside" : "dealer support / put wall";
  // BUG FIX (Ask Largo standing mandate, 2026-10-14, live repro: AMD WATCH brief). A call wall's
  // canonical side is ABOVE spot (resistance still ahead); a put wall's is BELOW (support still
  // underfoot). `near` alone (|distancePct| < 1.5) does not check which side the level is
  // actually on, so once price has genuinely traded THROUGH a level — e.g. a put wall sitting
  // ABOVE spot because price fell below what used to be support — the old code still picked the
  // "near, canonical side" text and said the opposite of reality: "support underfoot — hold while
  // above" for a support that had already given way. Live repro (GET /api/market/swing/play-brief
  // ?ticker=AMD, 2026-10-14): spot 558.15, put wall 560.00 (+0.3%, so "near"), LONG — this wrote
  // "Support underfoot — hold while above" in the SAME brief whose own "Vector desk: starred
  // level" bullet, two lines later, read "Lost the 560 put wall ... support gave way" — two
  // bullets in one section flatly contradicting each other about the same level. `breached` is
  // true exactly when the level is on the WRONG side of its canonical relationship to spot (a put
  // wall at/above spot, or a call wall at/below it), independent of `near`/`isCall` combos that
  // still assume the canonical side below.
  const breached = isCall ? level.distancePct <= 0 : level.distancePct >= 0;
  const action = breached
    ? isCall
      ? // Call wall now at/below spot: resistance has already been cleared on the way up.
        play.direction === "LONG"
          ? "cleared — former resistance, now potential support if it holds"
          : "reclaimed — resistance broken; short thesis at risk"
      : // Put wall now at/above spot: support has already given way on the way down.
        play.direction === "LONG"
          ? "support broken — now overhead; reclaim to get back in play, else expect continued downside"
          : "already broke — downside target cleared; watch for a bounce or continuation"
    : play.direction === "LONG"
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
  // GAP FOUND (Ask Largo standing mandate, 2026-10-24) — same omission as narrateDarkPool above,
  // see its comment.
  return `**GEX king ${fmtPriceLevel(level.price)}** (${fmtPct(level.distancePct)} from spot) — largest gamma concentration on the board. ${pin}`;
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
  // GAP FOUND (Ask Largo standing mandate, 2026-10-24) — same omission as narrateDarkPool above,
  // see its comment.
  return `**Gamma flip ${fmtPriceLevel(level.price)}** (${fmtPct(level.distancePct)} from spot) — regime line. ${longBreak}`;
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

// BUG FIX (Ask Largo standing mandate, 2026-10-25, live repro SWING:DKNG): this function had no
// `readMs`/staleness parameter at all, so it structurally could not call the shared
// `optionMarkStaleCaveat()` helper (play-brief-absence.ts) that `pnlSection` (play-brief.ts)
// already uses to flag the Position section's "P&L:" line as stale. The giveback bullets below
// (`giveback = mfeCaptureOutcome(play.pnlPct, play.peak, null)`) are computed from that exact same
// `play.pnlPct` — so a stale quote could render "P&L: **-9.8%** _(stale...)_" in Position and, a
// few sections later, an unqualified "Gave back 85% of peak" in Trade manager read, built off the
// identical stale number. The call site (`tradeManagerNarrativeSection`) already has `ctx.readMs`
// in scope two lines after this call (for vectorStale/gexStale) but never threaded it in. Adding
// `readMs` here (default `Date.now()`, same convention as every other readMs-taking helper in this
// file) rather than passing the pre-computed caveat string directly, so a future caller that
// doesn't already have `optionMarkStaleCaveat` computed doesn't need to import it separately.
function actionNarrative(play: TerminalPlay, bucket: "watch" | "open" | "closed", readMs: number = Date.now()): string | null {
  if (bucket === "closed") return null;

  const rec = play.recommendation ?? "HOLD";
  const health = thesisHealthUncalibrated(play.thesisHealth) ? null : play.thesisHealth?.health;
  const lines: string[] = [];

  if (bucket === "watch") {
    const gateCount = play.gateBlocks?.length ?? 0;
    const action = swingActionDisplay(play);
    // BUG FIX (2026-10-21, Ask Largo x Night Hawk Swings standing mandate, deferred follow-up to
    // #6532 named in that PR's own staged finding): a RESEARCH/SKIP candidate's `swingActionDisplay`
    // deliberately returns null (play-card-lifecycle.ts's own "SKIP deliberately returns null so
    // the honest PASSED lifecycle pill shows" comment) and `swingEntryAction` is always null too
    // (never enterable), so this chain fell straight through to `rec` — `play.recommendation`,
    // which `entry-verdict.ts`'s RESEARCH branch stamps the literal string "HOLD" even though
    // nothing was ever entered (same root cause #6532 fixed for the headline/Verdict line in
    // play-brief.ts, via `swingVerdictVerb`). Reuses that same shared helper rather than
    // re-deriving the SKIP special case a second time — `play.status === "SKIP"` is checked
    // FIRST (not appended as one more `??` fallback step) because `play.recommendation` is
    // non-null ("HOLD") for every SKIP row, so an appended fallback would never be reached; every
    // other `deckStatus` (WATCH here always resolves a real `action` label, so this ternary is a
    // no-op for it) keeps the exact prior chain, untouched.
    const actionLabel =
      play.status === "SKIP"
        ? swingVerdictVerb(play, action)
        : action?.label ?? play.swingEntryAction?.toUpperCase() ?? rec;
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

  // BUG FIX (Ask Largo standing mandate, 2026-10-25, live repro SWING:DKNG): `giveback` is derived
  // from `play.pnlPct` (see the comment above `giveback`'s own declaration) — the identical field
  // the Position section's "P&L:" line already flags via `optionMarkStaleCaveat` when stale. Shared
  // here so both giveback bullets below carry the same disclosure instead of rendering a confident
  // "gave back X%" off a quote the Position section two sections earlier already called stale.
  const giveStaleCaveat = optionMarkStaleCaveat(play, readMs);
  if (giveback?.kind === "round_trip") {
    lines.push(
      (anyTrimBanked
        ? `**Runner round-tripped past breakeven** — was up **${giveback.peakPct.toFixed(0)}%** at peak, now **${giveback.exitPnlPct.toFixed(0)}%**; part of this position is already banked at a profit — consider protecting what's left of the runner.`
        : `**Round-tripped past breakeven** — was up **${giveback.peakPct.toFixed(0)}%** at peak, now **${giveback.exitPnlPct.toFixed(0)}%** — consider protecting what's left.`) +
        giveStaleCaveat,
    );
  } else if (giveback?.kind === "capture" && giveback.capturePct < 75) {
    // BUG FIX (Ask Largo standing mandate, 2026-10-07): this "Gave back X% of peak" line
    // divides the SAME runner-only `play.pnlPct` the round_trip branch above divides (both
    // read the identical `giveback` from `mfeCaptureOutcome(play.pnlPct, play.peak, null)`),
    // but unlike that branch (fixed 2026-09-14 for the live CRWD repro — see `anyTrimBanked`'s
    // own comment a few lines up) this one never checked it. Live repro: 50% banked at the
    // +100% trim rail, runner pulls back to +20% off a +130% peak — capturePct = 20/130×100 ≈
    // 15.4%, well under the 75 floor, so this fires "Gave back **85%** of peak — consider
    // protecting runner." with no qualification at all, in the SAME "Trade manager read"
    // section that ALSO renders "Manage plan — all trims banked — runner only" a few bullets
    // later (holdPlanSection/manageLifecycleCoaching). A member reading only this bullet has
    // no way to know the alarming "85%" is the RUNNER's own retracement, not the whole
    // position's — the true blended return here is +60% (50%×100% + 50%×20%), a solid win,
    // not the near-total giveback the unqualified wording implies. Same fix shape as the
    // round_trip branch above: qualify the wording when a trim has already banked, rather than
    // only disambiguating the (rarer) full-loss case and leaving this far more common
    // post-trim-pullback case to read as a whole-position alarm.
    lines.push(
      (anyTrimBanked
        ? `Gave back **${(100 - giveback.capturePct).toFixed(0)}%** of the runner since peak — part of this position is already banked at a profit; consider protecting what's left.`
        : `Gave back **${(100 - giveback.capturePct).toFixed(0)}%** of peak — consider protecting runner.`) +
        giveStaleCaveat,
    );
  }

  return lines.join(" ");
}

/**
 * The exact `focal` entry `breakTrigger`'s "Break watch" bullet cites as this play's structural
 * stop (LONG) / reclaim level (SHORT), if any — same side-filtered `.find()` `breakTrigger` has
 * used since the 2026-09-11/09-15 fixes referenced below, factored out so other call sites
 * (`tradeManagerNarrativeSection`'s own level-narration loop, and `watchForSection`'s "Structural
 * support/resistance node" line, both below/elsewhere) can identify the SAME object by reference
 * rather than re-deriving the selection rule a second (or third) way and risking them drifting
 * apart.
 *
 * BUG FIX (Ask Largo standing mandate, 2026-10-08, live repro: PROF WATCH brief): the narration
 * loop iterates `focal` nearest-first and stops once `MAX_BULLETS` is reached, with NO awareness
 * that the reserved, always-shown "Break watch" bullet above depends on one specific entry in
 * that same array. A LONG breakout's resistance levels (call wall / GEX king / max pain) commonly
 * cluster NEAR spot while the one real support (put wall) sits much farther away — so on a ticker
 * with a couple of extra coaching bullets ahead of it (PROF had "Short interest" + "Confluence"
 * that a sibling ticker in the same scan lacked), the put wall was consistently the one entry
 * `.find()` selects here for "Break watch" yet the LAST one the narration loop would ever reach —
 * it never got its own explanatory bullet, while two bullets were spent explaining call wall and
 * GEX king (the same $7.50 strike, narrated twice) that have nothing to do with the downside risk
 * the Break watch line names. A member saw "Break watch — lose 5.00" with zero supporting
 * narration anywhere in "Trade manager read" for WHY 5.00 matters (it IS mentioned, unexplained,
 * in the separate "Levels on chart"/"What to watch" sections — this is specifically the narrated
 * coaching bullet going missing). The caller below now identifies this exact level and passes
 * `{ reserved: true }` into `add()` for it, the same bypass the Break watch/Counter-thesis bullets
 * already use — so the level a stated invalidation depends on can never be silently truncated.
 *
 * BUG FIX (Ask Largo standing mandate, 2026-10-08 :40 cycle, live repro SWING:TNGX:1611): exported
 * (was module-private) because a THIRD call site — `watchForSection`'s "Structural support node"/
 * "Structural resistance node" line in play-brief-intel.ts — had never been wired to this
 * selection at all. It hardcoded put wall (LONG) / call wall (SHORT) unconditionally, unaware the
 * 2026-09-15 fix above (see `breakTrigger`'s own comment) had already widened "Break watch"'s own
 * candidate set to whichever of put wall/dark pool/GEX king is actually NEAREST spot. Live TNGX
 * repro: GEX king (22.00) sat nearer spot (22.57) than the put wall (20.00), so `envelope.
 * invalidation`/"Break watch" correctly cited 22.00 while "What to watch", in the SAME envelope,
 * said "Structural support node: put wall 20.00" — two different numbers for what both sections
 * present as THE one structural level that matters, with nothing telling the member they're
 * reading two different concepts. `watchForSection` now calls this directly instead of
 * re-deriving its own put-wall-only version.
 */
export function resolveInvalidationFocalLevel(play: TerminalPlay, focal: FocalLevel[]): FocalLevel | undefined {
  if (play.direction === "LONG") {
    return focal.find(
      (l) => (l.kind === "put_wall" || l.kind === "dark_pool" || l.kind === "king") && l.distancePct < 0,
    );
  }
  if (play.direction === "SHORT") {
    // BUG FIX (Ask Largo standing mandate, 2026-10-20): the LONG branch above treats put_wall,
    // dark_pool, AND king as candidate invalidation levels; this SHORT branch omitted dark_pool —
    // not a deliberate asymmetry (narrateDarkPool explicitly supports a dark-pool print acting as
    // resistance for a SHORT thesis, and play-brief-ladder.ts's `riskTheOtherSide` treats dark_pool
    // fully symmetrically for both directions when picking the Structure Ladder's own focal level).
    // This function's own doc comment above states its whole purpose is that every section quoting
    // "the one structural level that matters" routes through here so they can never disagree — an
    // omitted kind on one side only is exactly the asymmetry that guarantee exists to prevent.
    return focal.find(
      (l) => (l.kind === "call_wall" || l.kind === "dark_pool" || l.kind === "king") && l.distancePct > 0,
    );
  }
  return undefined;
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
  //
  // Both predicates now live in `resolveInvalidationFocalLevel` above (2026-10-08) — same
  // selection, exposed so the narration loop can match on object identity.
  const invalidationLevel = resolveInvalidationFocalLevel(play, focal);
  const support = play.direction === "LONG" ? invalidationLevel?.price : undefined;
  const resist = play.direction === "SHORT" ? invalidationLevel?.price : undefined;
  // GAP FOUND (Ask Largo standing mandate, 2026-10-24): this is the single most safety-critical
  // line in the whole brief — reserved, always shown, bypasses MAX_BULLETS specifically because a
  // member must never miss it (see this function's own history above) — yet it never stated how
  // close the risk currently is, even though `FocalLevel.distancePct` (signed `(price-spot)/spot`,
  // this file's own comment a few lines up) is already computed and sitting right there on
  // `invalidationLevel`/the matched flip entry. No new spot plumbing, no new computation — just
  // threading a value that was already being discarded. `Math.abs()` matches every sibling
  // "(X% away)" figure elsewhere in this file (gamma flip, walls, the committed structural stop).
  const distAwaySuffix = (level: FocalLevel | undefined): string =>
    level ? ` (${Math.abs(level.distancePct).toFixed(1)}% away)` : "";

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
    const flipFocal = flip != null ? focal.find((l) => l.kind === "gamma_flip" && l.distancePct < 0) : undefined;
    const stop = support ?? (flipFocal ? flip : null);
    if (stop != null) {
      const action = preEntry ? "this setup is no longer live — skip it" : "exit or cut size";
      const distSuffix = distAwaySuffix(invalidationLevel ?? flipFocal);
      return `**Break watch** — lose **${fmtPriceLevel(stop)}**${distSuffix} on a closing basis → structural support failed; ${action}.`;
    }
  } else if (play.direction === "SHORT" && resist != null) {
    const action = preEntry ? "this setup is no longer live — skip it" : "cover shorts";
    const distSuffix = distAwaySuffix(invalidationLevel);
    return `**Break watch** — reclaim **${fmtPriceLevel(resist)}**${distSuffix} → resistance broken; ${action}.`;
  }
  return null;
}

/**
 * The REAL, committed structural stop for an already-OPEN swing position — `play.
 * invalidationUnderlyingPx` (sourced from the ledger's `thesis_invalidation_px`, pinned once at
 * commit, never recomputed). This is a DIFFERENT number from `breakTrigger`'s "Break watch" bullet
 * above (and `resolveBreakInvalidation`'s `envelope.invalidation` headline), which both cite a
 * GEX-heuristic level (nearest put wall / dark pool print / GEX king from `focal`) — an
 * independently-computed dealer-positioning read, genuinely useful on its own terms, but NOT the
 * number that actually governs the trade.
 *
 * WHY THIS MATTERS (Ask Largo standing mandate, 2026-10-16, live repro SWING:GOOGL:58): `manage.ts`'s
 * own header names `thesis_invalidation_px` PRECEDENCE RANK #1 among every management exit trigger
 * ("fires at ANY premium P&L, even +30% — the thesis is what broke, not the option... beats
 * expiry_risk" — see `manage-sync.ts`'s `structuralStopLevel: reads.structuralStopLevel ??
 * row.thesis_invalidation_px`). Despite being the single most consequential exit trigger in the
 * whole engine, it never appeared in the OPEN-bucket play-brief a member actually reads — every
 * section instead cited only the GEX heuristic, with the same confident framing, even when the two
 * numbers differ by 7x in distance from spot. `docs/audit/FINDINGS.md` (2026-09-12, "Structural
 * stop on an OPEN position is a live recompute, not the position's real committed stop") named this
 * exact gap for the Structure Ladder widget and explicitly deferred threading the real value onto
 * `TerminalPlay` as separate, out-of-scope plumbing; that threading landed later (`invalidationUnderlyingPx`
 * added to `TerminalPlay` 2026-09-28, for the CLOSED-bucket "stop fired" coaching line only) — but no
 * OPEN-bucket narrative call site ever read the field once it existed. This closes that gap.
 *
 * ADDITIVE per the Largo product contract — never replaces the GEX read, only adds a second,
 * clearly-labeled line when the real level is actually known. Returns null (never fabricates) when
 * either the real stop or a live spot is unavailable; callers keep showing exactly today's
 * GEX-only behavior in that case, no regression.
 */
export function committedStructuralStopLine(play: TerminalPlay, spot: number | null): string | null {
  const inval = fin(play.invalidationUnderlyingPx);
  if (inval == null || spot == null) return null;
  const alreadyThrough = play.direction === "SHORT" ? spot >= inval : spot <= inval;
  // BUG FIX (2026-10-17, Ask Largo standing mandate, live repro CRWV: spot 60.99, inval 57.06,
  // rendered "6.9% away" — that's (spot-inval)/inval, the WRONG denominator. Every sibling distance
  // figure in this same brief (call/put wall, max pain, gamma magnet — this file's own distPct()
  // helper above) divides by SPOT, not the target level, so this bullet's number silently used a
  // different convention from its neighbors in the identical prose block. Correct value: 6.4%.
  // Invisible at small distances (rounds identically either way below ~1%), which is why the
  // TSLA repro that found the separate spot-SOURCING question (PR #4076) never caught this too.
  const distPct = Math.abs(((spot - inval) / spot) * 100);
  if (alreadyThrough) {
    return `**Structural stop (committed)** — already through **${fmtPriceLevel(inval)}**, the real stop pinned at entry → an enforced exit regardless of option P&L, independent of the GEX read above.`;
  }
  return `**Structural stop (committed)** — lose **${fmtPriceLevel(inval)}** on a closing basis (${distPct.toFixed(1)}% away) → an enforced exit regardless of option P&L, independent of the GEX read above.`;
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
 *  evidence and stay untouched — only the Vector-specific reason is omitted when redundant.
 *
 *  `helixConflictAlreadyNoted` — BUG FIX (Ask Largo standing mandate, 2026-10-26): the identical
 *  double-citation shape as the Vector flag above, on the sibling desk the original 2026-09-09 fix
 *  didn't cover. `crossDeskCoaching` checks FOUR desks for conflicts — Night Hawk, 0DTE, Vector,
 *  and HELIX — off the exact same `trustedHelixFlow()` input and 1.3x call/put-premium ratio this
 *  function's own HELIX reason (a few lines below) uses, and names it in its own "Cross-desk
 *  friction" bullet (as lead: "HELIX put-led"/"HELIX call-led"; demoted: "HELIX also reads
 *  put-led/call-led"). But the caller's dedup check only ever matched the literal word "Vector" —
 *  never "HELIX" — so whenever crossDeskCoaching named HELIX as a conflict, this function's
 *  separate, ungated HELIX push re-cited the identical flow numbers as a second,
 *  independent-sounding "corroborating read" in the same document. Gated here exactly the way the
 *  Vector reason already is. */
export function counterThesisLine(
  ctx: SwingPlayBriefContext,
  play: TerminalPlay,
  spot: number | null,
  vectorConflictAlreadyNoted?: boolean,
  helixConflictAlreadyNoted?: boolean,
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
  if (flow && !helixConflictAlreadyNoted) {
    // BUG FIX (Ask Largo standing mandate, 2026-10-15): this was the only HELIX call/put-heavy
    // gate in this file (or its play-brief-intel.ts/play-brief.ts/play-brief-narrative-coaching.ts
    // siblings) using 1.2x — every other one (flowNarrative two screens up in this same file,
    // flowIntelSection's "Flow & positioning" bias label, crossDeskCoaching's "Cross-desk
    // friction" conflict check) uses 1.3x, with no comment here explaining a deliberate
    // divergence. At a ratio between 1.2x and 1.3x the brief said two contradictory things about
    // the identical flow numbers in the SAME "Trade manager read" bullet list this reason also
    // renders into: flowNarrative's "HELIX tape" bullet calls it "balanced" while this steelmanned
    // a "HELIX put-led"/"HELIX call-led" counter-thesis reason — a visible self-contradiction a
    // member could read in one document. Standardized on the 1.3x every other call site uses.
    if (play.direction === "LONG" && flow.put_premium > flow.call_premium * 1.3) {
      reasons.push(`HELIX put-led (${fmtFlowUsd(flow.put_premium)} vs ${fmtFlowUsd(flow.call_premium)} calls)`);
    } else if (play.direction === "SHORT" && flow.call_premium > flow.put_premium * 1.3) {
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

  // GAP FOUND (Ask Largo standing mandate, 2026-10-09, live repro GDDY committed position): EMA
  // stack is only ONE of the four votes `technicalsBias()` (play-brief-technicals.ts) counts when
  // it decides the chart's own aggregate bias — the identical function `technicalsCoaching`
  // (play-brief-narrative-coaching.ts) uses, two bullets above this one in the SAME "Trade manager
  // read" section, to print "chart reads bearish (conflicts with swing direction)". MACD and
  // market-structure direction (BOS/CHOCH) are the other two votes, and neither was ever checked
  // here — so whenever a chart turns bearish on MACD+structure alone (EMA merely "mixed", not
  // "down"), this function silently returned NO counter-thesis reason at all for that evidence,
  // even though the brief's own "Chart read" bullet, right above, already told the member the chart
  // conflicts with their LONG thesis. Live: GDDY 2026-10-09 — EMA "mixed" (no vote), MACD "bear",
  // structure CHOCH down — technicalsBias() correctly read "bearish" and printed the conflict
  // bullet, but counterThesisLine() returned null outright (reasons.length stayed 0 end to end),
  // understating the evidence to "nothing to weigh" when a second, independent reason (the call
  // wall overhead, already captured below) existed alongside it. Each vote is pushed as its own
  // fact, same per-indicator granularity as the EMA-stack reason above — they are independent
  // reads (MACD momentum vs. EMA trend-stack vs. swing-structure breaks), not a restatement of one
  // another, so corroboration correctly increments once per vote that actually fires.
  const macd = !vectorStale ? vec?.technicals?.macd ?? null : null;
  if (play.direction === "LONG" && macd === "bear") reasons.push("bear MACD on chart");
  if (play.direction === "SHORT" && macd === "bull") reasons.push("bull MACD on chart");

  const structure = !vectorStale ? vec?.technicals?.structure ?? null : null;
  if (play.direction === "LONG" && structure?.direction === "down") {
    reasons.push(`bearish structure break (${(structure.type || "CHOCH").replace(/_/g, " ")} down)`);
  } else if (play.direction === "SHORT" && structure?.direction === "up") {
    reasons.push(`bullish structure break (${(structure.type || "BOS").replace(/_/g, " ")} up)`);
  }

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
  // BUG FIX (2026-10-21, Ask Largo round-3 deep-dive, live repro TSLA): a faded pillar used to be
  // pushed straight into `reasons[]`, counted identically to a genuine directional read (HELIX
  // flow, Night Hawk, Vector bias, a wall, EMA/MACD/structure, dealer posture) for the "corroborated
  // across N independent reads" weight label below. But Theta budget (thesis-health.ts's
  // thetaBudgetScore — "time decay is the whole point of the pillar") transitions PURELY off DTE vs
  // a fixed cliff/migration threshold, with zero dependence on price, flow, or any other market
  // signal — it fades on the calendar alone, whether the position is winning or losing. Counting it
  // toward "independent reads" let a position with exactly one real opposing signal (e.g. dealer
  // gamma) plus a mechanically-expiring Theta pillar read as "corroborated across 2 independent
  // reads," overstating conviction right when members are most likely weighing whether to
  // hold/add/exit (near expiry). This is the same "time-based ≠ directional corroboration"
  // distinction `sellReasonClause()` already applies a few hundred lines up in this same file
  // (fixed 2026-09-10: `expiry_risk`/`time_stop` render as "time-based: ... thesis still intact",
  // never a thesis break) — applied here to the evidence-WEIGHT label instead of the exit-reason
  // label. The fading-pillar fact is still shown in the bullet (a real, calendar-driven risk worth
  // surfacing) — it just no longer inflates the count the weight label is based on.
  let fadedPillarReason: string | null = null;
  if (faded && (!play.thesisBreak?.level || play.thesisBreak.level === "intact")) {
    fadedPillarReason = `fading pillar **${faded.label}**`;
  }

  if (!reasons.length && !fadedPillarReason) return null;

  const side = play.direction === "LONG" ? "bear" : "bull";
  const allClauses = fadedPillarReason ? [...reasons, fadedPillarReason] : reasons;
  const shown = allClauses.slice(0, 3);
  // A single-reason counter-thesis and one where 3 independent desks/reads agree were rendering
  // with identical prose weight — "Counter-thesis (bear case) — <reason(s)>" either way — so a
  // member had no way to tell an isolated signal from a corroborated one without counting clauses
  // themselves. Live-confirmed both shapes exist today (AAPL: 3 reasons: call wall + EMA stack +
  // dealer posture; NRG/NN/META: exactly 1 reason each). The count itself is never fabricated —
  // it's `reasons.length`, the same array already gathered above — so this only labels evidence
  // strength honestly, the same discipline as the Largo product contract's confidence-omission
  // rule (state real weight, never invent it, never flatten it away either).
  //
  // BUG FIX (Ask Largo standing mandate, 2026-10-15): the comment above has always said the count
  // is `reasons.length` — the code read `shown.length` instead, which this file's own `.slice(0,3)`
  // two lines up pins at a max of 3. `reasons` can independently collect up to 10 distinct votes
  // (HELIX flow, Night Hawk, 0DTE, Vector bias, a wall, EMA, MACD, structure break, dealer posture,
  // fading pillar), all push-gated separately with nothing capping them before this point — so any
  // time 4+ genuinely corroborate, a member saw "corroborated across 3 independent reads" while the
  // real count was higher, understating conviction exactly when the counter-thesis is strongest.
  // Only the DISPLAYED clauses are capped at 3 for join-string length; the count label now reflects
  // the full evidence gathered, same precision discipline as everywhere else in this function.
  const weight =
    reasons.length >= 2
      ? `corroborated across ${reasons.length} independent reads — `
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

function degradedReadLine(
  play: TerminalPlay,
  bucket: "watch" | "open" | "closed",
  readMs: number = Date.now(),
): string | null {
  if (bucket === "closed") return null;
  // BUG FIX (Ask Largo standing mandate, 2026-10-07, blast radius of #5620): #5620 fixed the
  // identical narrative-vs-chip disagreement for dataFreshnessSection (play-brief-intel.ts) and
  // extracted the shared `isSwingPlayStaleCheckExempt` predicate specifically so a third call site
  // couldn't silently reintroduce the same split — but this function, a SIBLING "is today's live
  // desk state current" narrative line in a DIFFERENT file, was never updated to use it. Live repro
  // (same NTAP brief #5620 itself reproduced against, `entryStatus: "EXTENDED_CHASE"`, status
  // `COMMIT`/bucket "watch", confirmed live 2026-10-07 AFTER #5620 merged): this function still
  // rendered "**Live read** — Vector spot not wired on this tick; desk still says **WAIT**" while
  // the SAME envelope's `unavailableSources` was `[]` and `confidence.why` read "Every live source
  // this brief reads from resolved cleanly this cycle" — the exact contradiction #5620 fixed for
  // the Data-freshness section, recurring here because this is a separate function, not touched by
  // that fix. A dead-but-not-closed WATCH candidate (extended past entry, invalidated, expired) has
  // nothing left to refresh — asserting "Vector spot not wired ON THIS TICK" implies a live poll is
  // still meaningfully running, which #5620's own rationale says is false for this bucket. Gate on
  // the shared predicate rather than reinventing a third local check.
  if (bucket === "watch" && isSwingPlayStaleCheckExempt(play)) return null;
  const degradedAction = swingActionDisplay(play);
  // BUG FIX (2026-10-21, Ask Largo x Night Hawk Swings standing mandate, deferred follow-up to
  // #6532, same root cause as `actionNarrative`'s own "Entry stance" fix above in this file): a
  // RESEARCH/SKIP candidate reaches this line whenever Vector/GEX spot isn't wired this tick (the
  // ONLY path that calls this function, per `tradeManagerNarrativeSection`'s `spot == null`
  // branch) — `swingActionDisplay` returns null for SKIP, so this chain fell straight through to
  // `play.recommendation`, the literal "HOLD" string `entry-verdict.ts`'s RESEARCH branch always
  // stamps (never null/undefined for SKIP, so appending a SKIP check as one more `??` fallback
  // step here would never be reached — same reason the fix below checks `play.status` FIRST
  // rather than appending). Reuses the shared `swingVerdictVerb` helper (play-brief.ts) rather
  // than re-deriving the SKIP special case a third time; every other `deckStatus` keeps the exact
  // prior chain, untouched.
  const rec =
    play.status === "SKIP"
      ? swingVerdictVerb(play, degradedAction)
      : degradedAction?.label ?? play.recommendation ?? play.swingEntryAction?.toUpperCase() ?? "HOLD";
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
  //
  // BUG FIX (Ask Largo standing mandate, 2026-10-07): same root cause as actionNarrative's own
  // capture-branch fix a few hundred lines above — this bit divides the same runner-only
  // `play.pnlPct` giveback.capturePct is built from, with no disclosure that a already-banked
  // trim tranche means the "gave back X% from peak" figure describes the RUNNER leg only, not
  // the whole position's blended outcome. Lower-stakes than the sibling fix (this band is
  // [75,80), a mild giveback, not the dramatic case) but the same honest-disclosure gap, so it
  // gets the same `anyTrimBanked` qualifier rather than being left as the one unfixed sibling.
  const anyTrimBanked = (play.exitPolicy?.trim_levels ?? []).some((t) => t.fired);
  const givebackBit =
    giveback?.kind === "capture" && giveback.capturePct >= 75 && giveback.capturePct < 80
      ? anyTrimBanked
        ? ` · gave back **${(100 - giveback.capturePct).toFixed(0)}%** from the runner's own peak (part already banked at a profit)`
        : ` · gave back **${(100 - giveback.capturePct).toFixed(0)}%** from peak`
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
  //
  // BUG FIX (Ask Largo standing mandate, 2026-10-26, live repro PANW SWING:PANW:67): the TRUE
  // entry-fallback case above is guarded, but the far more common "real mark, aged `markAsOf`"
  // case (`optionMarkIsStale`) was never disclosed here — this bullet never called the shared
  // `optionMarkStaleCaveat` helper every OTHER quote-derived line in the identical brief/section
  // already does (Position section's Mark/P&L/Peak/Trough/Greeks/Spread/Exec P&L lines; this same
  // "Trade manager read" section's own "Manage plan" and "Executable P&L" bullets; the "Break
  // watch" already-breached bullet fixed in #6756 for this exact root cause at a sibling call
  // site). Live PANW repro (2026-10-26 ~08:24 ET): Position section correctly flagged "Mark:
  // **$19.45** ... _(stale)_" and the same brief's "Manage plan"/"Executable P&L" bullets both
  // carried " _(stale — same quote Mark flagged above)_" for the identical $19.45 figure, but THIS
  // bullet ("Live read" — the one reserved fallback fired whenever Vector/GEX spot isn't wired, the
  // only branch that ever calls this function) rendered "mark **$19.45**" with no caveat at all,
  // even though the quote was 64+ hours stale (`markAsOf` 2026-10-23 16:00 ET vs the read at
  // 2026-10-26 08:24 ET). `readMs` is already the canonical "now" every sibling call in this file
  // threads through (see `actionNarrative`'s own `readMs` param a few hundred lines above, and the
  // `optionMarkStaleCaveat(play, readMs)` call on the Break-watch bullet below) — this function's
  // signature just never had the parameter added, so it silently fell back to the helper's own
  // `Date.now()` default, computing staleness correctly in isolation but never actually being
  // called to compute it. Threading `ctx.readMs` through (one extra default-valued parameter, one
  // appended call) makes this bullet agree with every sibling line in the same response instead of
  // contradicting them on the exact same dollar figure.
  const markBit =
    play.mark != null && !optionMarkGenuinelyUnknown(play)
      ? ` · mark **${fmtOptionUsd(play.mark)}**${optionMarkStaleCaveat(play, readMs)}`
      : "";
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

  const action = actionNarrative(play, bucket, readMs);
  if (action) add(action);

  const rollLine = rollHistoryLine(ctx);
  if (rollLine) add(rollLine);

  for (const line of collectCoachingBullets(ctx, bucket, spot)) add(line);

  if (spot != null) {
    const posture = dealerPostureLine(ctx, spot, bucket);
    if (posture) add(posture);
  } else {
    const degraded = degradedReadLine(play, bucket, readMs);
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
    // BUG FIX (Ask Largo standing mandate, 2026-10-08, live PROF repro — see
    // `resolveInvalidationFocalLevel`'s own doc comment for the full account): this is the SAME
    // level `breakTrigger` below will cite in the reserved, always-shown "Break watch" bullet —
    // when it's also the one `focal` entry this loop would otherwise drop for being farthest from
    // spot (sorted nearest-first, capped at MAX_BULLETS), the brief ends up naming an invalidation
    // price with no supporting bullet anywhere in this section. Identify it by reference so its
    // own narration bypasses the cap exactly like Break watch itself does.
    const invalidationLevel = resolveInvalidationFocalLevel(play, focal);

    for (const level of focal) {
      const isInvalidationLevel = level === invalidationLevel;
      // Only skip a level once the cap is hit AND it isn't the one Break watch depends on —
      // `continue` (not `break`) so a later, farther-sorted invalidation level is still reached
      // and reserved rather than the loop exiting before it ever gets there.
      if (!isInvalidationLevel && bullets.length >= MAX_BULLETS) continue;
      if (level.kind === "dark_pool" && !used.has("dark_pool")) {
        add(narrateDarkPool(level, play, spot), { reserved: isInvalidationLevel });
        used.add("dark_pool");
      } else if (level.kind === "put_wall" && !used.has("put_wall")) {
        add(narrateWall(level, play), { reserved: isInvalidationLevel });
        used.add("put_wall");
      } else if (level.kind === "call_wall" && !used.has("call_wall")) {
        add(narrateWall(level, play), { reserved: isInvalidationLevel });
        used.add("call_wall");
      } else if (level.kind === "magnet" && !used.has("magnet") && !bullets.some((b) => /Gamma magnet/i.test(b))) {
        add(narrateMagnet(level, resolveGammaPosture(ctx, vec)));
        used.add("magnet");
      } else if (level.kind === "king" && !used.has("king")) {
        add(narrateKing(level, resolveGammaPosture(ctx, vec)), { reserved: isInvalidationLevel });
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
  // BUG FIX (Ask Largo standing mandate, 2026-10-25, live repro EXPE: bid $0.00 / ask $1.20, a
  // real two-sided quote, not a missing one): `play.execMark` is null both when there is no bid at
  // all and when the bid is a confirmed $0.00 — `play.execBidZero` (adapters.ts) distinguishes the
  // two. A confirmed $0.00 bid is at/through ANY positive stop by construction (there is no buyer
  // at any price), so without this it fell through to the softer "future risk" `breakLine`
  // fallback below instead of this reserved, always-surfaced "already breached" bullet — the
  // MOST severe case getting WEAKER disclosure than a comparable nonzero-but-low bid (e.g. a bid
  // of $0.10 already through the same stop correctly fires this bullet).
  const execMarkForBreach = play.execBidZero === true ? 0 : play.execMark;
  const execBreached = execStop != null && execMarkForBreach != null && execMarkForBreach <= execStop;
  // BUG FIX (2026-10-17, Ask Largo standing mandate, live repro SWING:GTLB): the 2026-09-15 fix
  // above only surfaced "stop already breached on the executable side" when `breakLine` was still
  // null, i.e. when `breakTrigger()` found no structural GEX level to cite. Live on GTLB
  // (committed LONG, exec P&L -84.6% vs mid -53.8%, bid $0.10 already through the $0.26 premium
  // stop), `breakTrigger()` DID find a structural put-wall break ("lose 27.50 ... exit or cut
  // size"), so this whole block was skipped under the old `!breakLine` guard and the executable
  // breach silently reverted to being only a footnote (watchForSection's "no real cushion on the
  // executable side" note, play-brief-intel.ts) — the exact "easily missed" failure mode the
  // 2026-09-15 fix exists to prevent, reappearing whenever a structural break also exists. Fix:
  // surface the executable-breach fact as its OWN reserved bullet whenever it's true, additive to
  // (never replacing) any structural breakLine — the two are independent, equally real risks and
  // the Largo contract's additive principle says keep both rather than letting one eclipse the
  // other.
  // BUG FIX (Ask Largo standing mandate, 2026-10-26, live repro PHM): this bullet says the breach
  // is happening "right now" off `execMarkForBreach`/`execStop`, priced from the exact same
  // bid/ask/markAsOf snapshot every sibling line in this function (the giveback bullet via
  // `giveStaleCaveat` above, and pnlSection/the manage-plan distance clause elsewhere in this
  // brief) already flags as stale via `optionMarkStaleCaveat`. Left unqualified, this is the one
  // bullet in the section that asserts freshness ("right now") instead of disclosing it — on the
  // single most action-driving line in the brief ("exit or cut size"). Same bug class PRs #6726/
  // #6731/#6736 already swept through every other call site in this file; this one was missed.
  if (execBreached && (play.direction === "LONG" || play.direction === "SHORT")) {
    add(
      `**Break watch — stop already breached on the executable side** — bid **${fmtOptionUsd(execMarkForBreach)}** is at/through your premium stop **${fmtOptionUsd(execStop)}** right now → exit or cut size.${optionMarkStaleCaveat(play, readMs)}`,
      { reserved: true },
    );
  } else if (!breakLine && play.direction === "LONG" && execStop != null) {
    breakLine = `**Break watch** — lose premium stop **${fmtOptionUsd(execStop)}** → cut size or exit.`;
  } else if (!breakLine && play.direction === "SHORT" && execStop != null) {
    // BUG FIX (Ask Largo standing mandate, 2026-10-20): this used to say "reclaim $X -> cover
    // shorts", implying the trigger is the premium RISING back up to X. But a swing play is always
    // LONG PREMIUM regardless of direction (see the 2026-09-15 comment above this block) — execStop
    // is a premium FLOOR, and execBreached (a few lines up) fires when the premium falls TO OR
    // BELOW it, for BOTH directions alike. "Reclaim" is the right word for a structural resistance
    // level a SHORT thesis invalidates by reclaiming from below (narrateFlip/narrateWall use it
    // correctly for exactly that) — it is backwards for a premium floor, which can only be breached
    // by a fall. The LONG branch above already says "lose" for the identical kind of value; this
    // branch must match it.
    breakLine = `**Break watch** — lose premium stop **${fmtOptionUsd(execStop)}** → cover shorts.`;
  }
  if (breakLine) add(breakLine, { reserved: true });

  // Ask Largo standing mandate (2026-10-16, live repro SWING:GOOGL:58): `breakLine` above is the
  // GEX-heuristic "Break watch" level — add the REAL, committed structural stop as its own
  // distinct, reserved bullet whenever it's known. See committedStructuralStopLine's own doc
  // comment for the full root-cause/contract rationale. OPEN-bucket only (bucket==="closed"
  // already returned above; a WATCH candidate has no committed position yet, so its
  // `invalidationUnderlyingPx` — if a dossier pinned one — describes a hypothetical plan, not an
  // enforced exit, and showing it here under this label would overclaim).
  if (bucket === "open") {
    const structuralStopLine = committedStructuralStopLine(play, spot);
    if (structuralStopLine) add(structuralStopLine, { reserved: true });
  }

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
  // BUG FIX (Ask Largo standing mandate, 2026-10-26): same dedup shape as the Vector flag above,
  // for the sibling desk crossDeskCoaching also checks — HELIX. Without this, counterThesisLine's
  // own ungated HELIX push re-cited the same flow numbers as a second, independent-sounding
  // "corroborating read" whenever crossDeskCoaching named HELIX as a conflict (lead: "HELIX
  // put-led/call-led"; demoted "rest": "HELIX also reads put-led/call-led"). See
  // counterThesisLine's own doc comment for the full mechanism + regression test.
  const helixConflictAlreadyNoted = bullets.some((b) => /HELIX (?:also reads )?(call|put)-led/.test(b));
  const counter = counterThesisLine(ctx, play, spot, vectorConflictAlreadyNoted, helixConflictAlreadyNoted);
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
