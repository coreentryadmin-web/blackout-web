/**
 * Swing Play Intelligence — rich deterministic sections.
 * Surfaces chart technicals, flow, GEX nodes, catalysts, watch levels, and hold plan.
 */
import type { RichSection } from "@/lib/bie/rich-narrative";
import { hasScaledOut, runnerTrailingStopPremium } from "@/lib/zerodte/terminal-ladder";
import { fmtOptionUsd as fmtUsd, fmtPct, fmtPremium, fmtPriceLevel } from "@/lib/fmt-money";
import { parseOccSymbol } from "@/lib/largo/core/entities";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import {
  playExpectsLiveOptionMark,
  ageDaysLabel,
  ageSecondsLabel,
  closedMarketSessionNote,
  confluenceZoneKindsLabel,
  fundamentalsAgeMs,
  fundamentalsAncient,
  darkPoolStale,
  fundamentalsFreshnessTag,
  gexMatrixAgeMs,
  gexMatrixStale,
  meridianCatalystAgeMs,
  meridianCatalystStale,
  newsCatalystAgeMs,
  newsCatalystStale,
  optionMarkGenuinelyUnknown,
  optionMarkIsStale,
  resolveGammaPosture,
  vectorAgeStale,
  vectorSnapshotStale,
} from "./play-brief-absence";
import type { SwingPlayBriefContext } from "./play-brief-types";
import type { LargoTimelineItem } from "@/lib/largo/meridian-timeline-for-largo";
import { laneRankSection } from "./play-brief-lane-rank";
import {
  tradeManagerNarrativeSection,
  collectFocalLevels,
  resolveInvalidationFocalLevel,
} from "./play-brief-narrative";
import { technicalsBias } from "./play-brief-technicals";
import type { VectorFullState } from "@/lib/bie/vector-full-state";
import type { EcosystemContext } from "@/lib/bie/ecosystem-context";
import type { ConfluenceZone } from "@/features/vector/lib/vector-confluence";
import { nearestWallFromLevels, type NearestWall } from "@/lib/providers/gex-nearest-wall";
import { checkPortfolioOverlap, type PortfolioPosition } from "./portfolio";
import { describeThemeOverlap, effectiveDirection, isInverseLeverageEtf } from "./theme-cluster";
import { NO_SECTOR_BENCHMARK_THEMES } from "./industry-group-rs";
import { sectorFor } from "../portfolio/sector-map";
import { parseSwingPlayId } from "./play-brief-resolve-pure";
import {
  trustedHelixFlow,
  zerodteLiveForSession,
  relativeAgeLabel,
  archetypeTrackRecordIsStale,
} from "./play-brief-absence";
import { mfeCaptureOutcome } from "./mfe-capture";
import { collapseRedundantIntelSections } from "./play-brief-intel-collapse";
import { etSessionDate, etStampFromIso, parseEtStamp } from "@/lib/largo/temporal/bar-session-date";
import { printAlreadyLandedThresholdMs } from "./play-brief-narrative-coaching";
import { formatDealerDollars } from "./format-nonzero";
import { daysBetweenYmd } from "@/lib/meridian/meridian-event-expiry-core";
import { deadPlayReason, gateFramingMootReason, isSwingPlayStaleCheckExempt } from "./entry-enterability";
import { isLegacyPromotedSignal } from "./legacy-confirm-promote";
import { thesisHealthUncalibrated } from "./thesis-health";
import { BANGER_LEDGER_REGIME_LABEL } from "./banger-lane-merge";
import {
  archetypeLabelFromRaw,
  subLaneLabelFromRaw,
  ARCHETYPE_META,
  SWING_ARCHETYPES,
  SWING_SUB_LANES,
  SWING_SUB_LANES_ORDER,
} from "./taxonomy";
import {
  graduatedArchetypeEntry,
  graduatedSubLaneEntry,
  type SwingArchetypeTrackRecordSnapshot,
  type SwingTrackRecordEntry,
} from "./calibration-cache";
import type { SwingTickerTrackRecord } from "./play-brief-ticker-history";
import {
  meridianPeerEarningsCoaching,
  pickEarningsForSwingPeer,
} from "./play-brief-meridian-peer-core";

// Absolute per-contract/level PRICE formatting is `fmtUsd` (aliased from @/lib/fmt-money's
// `fmtOptionUsd` above) — see that module for the rounding-consistency history this file's own
// local copy needed fixing for (2026-09-12).

function fmtDist(spot: number, level: number): string {
  const delta = level - spot;
  const pct = (delta / spot) * 100;
  const pctSign = pct >= 0 ? "+" : "";
  // fmtUsd (fmtOptionUsd) is documented "never signed" — a raw negative delta produces "$-19.48"
  // (toFixed(2) puts the minus BEFORE the digits, so "$" lands ahead of it). Sign it ourselves,
  // outside the glyph, the same way fmt-money.ts's fmtPremium already does for this exact trap.
  const deltaSign = delta < 0 ? "-" : "";
  return `${pctSign}${pct.toFixed(1)}% (${deltaSign}${fmtUsd(Math.abs(delta))} from spot)`;
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
// GAP FOUND (Ask Largo standing mandate — PR #4076 comment 6107462205, 2026-10-11): raised as a
// question for Cursor ("is this a deliberate terse metadata summary, or a narrative candidate like
// crossDeskCoaching/counterThesisLine?"); no reply after 6+ hours, so taking the conservative half
// of the proposal myself — same "took it myself after an unclaimed overnight comment" precedent
// already set on this same thread (comment 6082520455).
//
// Deliberately NOT a full rewrite of this section: ~20 existing tests each pin one field's EXACT
// bolded line (e.g. `/\*\*Archetype:\*\* Breakout continuation/`), several encoding hard-won bug
// fixes (the SwingSubLane raw-enum leak, the archetype near-tie disclosure, the industry-read
// rounding-consistency fix) — collapsing everything into one prose sentence would risk silently
// dropping one of those disclosures, which is exactly the failure class this file's other comments
// warn against. So this is PURELY ADDITIVE: a synthesized lede sentence for the common, simple case
// only, prepended above the untouched flat lines — never replacing them. The lede explicitly stands
// down (returns null, falling through to the original flat lines) whenever a genuinely informative
// edge case is present (a near-tie classification, a thin-evidence entry, a withheld score) — those
// are exactly the cases that deserve their OWN explicit callout, not a smoothed-over sentence.
function synthesizedSetupLede(
  play: TerminalPlay,
  whyArchetypeLabel: string | null,
  subLaneLabel: string | null,
): string | null {
  if (!play.discoveryOrigin?.length || !whyArchetypeLabel) return null;
  // A withheld/near-tie/thin-evidence read is informative precisely BECAUSE it's unusual — folding
  // it into one clean sentence would misrepresent how settled the read actually was.
  if (play.scoreWithheld) return null;
  if (play.archetypeNearTie) return null;
  if (play.entryPresentPillars != null) return null;
  const signals = play.discoveryOrigin.join("/");
  const maturity = play.setupState ? play.setupState.toLowerCase() : null;
  const archetypePhrase = maturity
    ? `${maturity} ${whyArchetypeLabel.toLowerCase()}`
    : whyArchetypeLabel.toLowerCase();
  // FIX (Ask Largo standing mandate, 2026-10-14, live AMD repro): `setupState` includes EXTENDED,
  // a vowel-starting value, so the hardcoded "a" article ("a extended pullback continuation setup")
  // read as a grammar bug in otherwise-polished trade-manager prose. `archetypePhrase` always
  // starts with `maturity` (a lowercased setupState enum member) when present, so a simple
  // vowel-sound check on its first letter is sufficient here — this is prose assembled from a
  // closed, known enum, not arbitrary user text.
  const article = /^[aeiou]/i.test(archetypePhrase) ? "an" : "a";
  // Deliberately does NOT fold `play.regime` in here, even though it reads naturally alongside the
  // archetype: `play.archetype` is PINNED at commit while `play.regime` is re-derived fresh on every
  // scan (see the "Today's regime read" line's own comment below) and the two can genuinely diverge
  // without either being wrong. That divergence is exactly the thing the separate, explicitly-labeled
  // "Today's regime read" line exists to surface honestly — smashing both into one sentence here would
  // reintroduce the "pinned archetype next to a silently different fresh read, no framing" bug this
  // file already fixed once (2026-09-14, KR). `subLaneLabel` carries no such pinned/fresh split
  // (sub-lane doesn't change after commit), so it's safe to fold in.
  const contextStr = subLaneLabel ? ` (${subLaneLabel})` : "";
  // play.score is the real, authoritative total — never re-summed from `factors` (the exact
  // independently-rounded-related-quantities precision bug this file's own industry-read fix
  // (2026-10-09) already warns about, one call site over).
  const scoreStr = Number.isFinite(play.score) ? `, scoring ${Math.round(play.score)}` : "";
  return `${signals} flagged this as ${article} ${archetypePhrase} setup${contextStr}${scoreStr}.`;
}

export function whyThisSetupSection(
  play: TerminalPlay,
  bucket?: "watch" | "open" | "closed",
): RichSection {
  const lines: string[] = [];
  const whyArchetypeLabel = archetypeLabelFromRaw(play.archetype);
  const subLaneLabel = subLaneLabelFromRaw(play.subLane);
  const lede = synthesizedSetupLede(play, whyArchetypeLabel, subLaneLabel);
  if (lede) {
    lines.push(lede);
  } else {
    if (play.discoveryOrigin?.length) {
      lines.push(`**Signals fired:** ${play.discoveryOrigin.join(" · ")}`);
    }
    if (whyArchetypeLabel) lines.push(`**Archetype:** ${whyArchetypeLabel}`);
  }
  // GAP FOUND (Ask Largo standing mandate, 2026-09-18): scoring/gating/calibration all partition on
  // this single pinned archetype label, but nothing on this brief ever disclosed HOW decisive the
  // classifier's own call was — see live-plays.ts's `archetypeNearTieFromFeatureVector` for the full
  // trace. Only rendered when the entry-time classification was genuinely a near-tie (the classifier's
  // own MARGIN_EPS bar); a decisive call (the overwhelming common case) adds nothing here.
  //
  // BUG FOUND (2026-09-18, same standing mandate, live repro NN:32 CLOSED brief): this used to fire
  // off `play.archetypeNearTie` alone, with a `whyArchetypeLabel ?? "the winning archetype"` fallback
  // for when `play.archetype` was itself null (a real, reachable thin-evidence-commit case —
  // `archetypeNearTieFromFeatureVector` is now hardened against producing a near-tie in that case too,
  // see its own doc comment). Requiring `whyArchetypeLabel` here is the second, render-layer half of
  // that fix: even if a future caller ever constructs a `TerminalPlay` with `archetypeNearTie` set but
  // no real `archetype`, this line still can't fabricate a "the winning archetype beat X" claim with
  // no preceding "Archetype:" line to anchor it.
  if (play.archetypeNearTie && whyArchetypeLabel) {
    // BUG FOUND (Ask Largo standing mandate, 2026-09-18): `marginPct` is `Math.round(margin * 100)`
    // (live-plays.ts) and can legitimately round to exactly 0 — an exact classifier tie, still inside
    // ARCHETYPE_NEAR_TIE_MARGIN. "beat X by only 0 pts" is self-contradictory at that value: a 0-point
    // margin means no beat occurred, priority order broke the tie some other way. Special-cased so the
    // prose never claims a "beat" with zero evidence of one.
    lines.push(
      play.archetypeNearTie.marginPct === 0
        ? `**Classification:** near-tie at entry — **${whyArchetypeLabel}** tied with ` +
            `**${play.archetypeNearTie.secondaryLabel}**; priority order broke the tie.`
        : `**Classification:** near-tie at entry — **${whyArchetypeLabel}** beat ` +
            `**${play.archetypeNearTie.secondaryLabel}** by only ${play.archetypeNearTie.marginPct} pts.`,
    );
  }
  // BUG FOUND (Ask Largo standing mandate, 2026-10-08): this used to print `play.subLane.replace(/_/g,
  // " ")` — a no-op on every REAL `SwingSubLane` value (`TACTICAL`/`STANDARD`/`EXTENDED` have no
  // underscore), so it rendered the shouty raw enum ("Sub-lane: TACTICAL") while the archetype line
  // immediately above, `archetypeTrackRecordSection` further down this SAME brief, and the live
  // command-deck UI (`terminal-display.ts`) all render the identical field as "Tactical (5–7d)" —
  // see `subLaneLabelFromRaw`'s own doc comment (taxonomy.ts) for the full trace. Unrecognized/foreign
  // values render nothing here, same honest-absence discipline `archetypeLabelFromRaw` already uses.
  // (subLaneLabel is now computed once, at the top of this function, so the lede above can use it too.)
  if (!lede && subLaneLabel) lines.push(`**Sub-lane:** ${subLaneLabel}`);
  // GAP FOUND (Ask Largo standing mandate, 2026-09-18): the pre-entry WATCH note for the identical
  // fact ("thin read — N/7 pillars grounded", serving-ingest.ts) never survives WATCH→COMMIT — see
  // `entryPresentPillarsFromFeatureVector`'s own doc comment (live-plays.ts) for the full trace.
  // `entryPresentPillars` is only ever non-null when the entry read was genuinely thin (same
  // dataQuality.degraded threshold the WATCH note gates on), so this line is silent on the
  // overwhelming common case of a healthy entry.
  if (play.entryPresentPillars != null) {
    lines.push(`**Evidence at entry:** thin read — **${play.entryPresentPillars}/7** pillars grounded`);
  }
  // GAP FOUND (Ask Largo standing mandate, 2026-09-18): the entry-time contract pick (chosen
  // independently by tradability×thesisFit, contract-ranker.ts) is checked at commit against the
  // multi-day flow's own magnet strike, and the raw flow strike is pinned onto every committed
  // row's `top_flow_strike` column — but neither the number nor the match/mismatch was ever
  // surfaced. Both directions are informative: agreement is corroboration (the strike flow was
  // piling into is the same one the independent ranker picked on its own terms); a mismatch is a
  // real, disclosed divergence worth a member's attention (the held contract sits at a DIFFERENT
  // strike than where the accumulation flow was concentrated), not something to silently drop.
  if (play.topFlowProvenance) {
    const { topFlowStrike, matchedPick } = play.topFlowProvenance;
    // GAP FOUND (Ask Largo standing mandate, 2026-10-20): the mismatch branch named the flow's
    // magnet strike but never the pick's OWN strike, forcing a reader to cross-reference the
    // Verdict section's `play.contract` label to see how far apart the two actually are — the
    // exact kind of "trust me, they're different" prose this file's own header otherwise avoids.
    // `play.occ` (parsed via the shared `parseOccSymbol`, already the established pattern for this
    // exact need — see play-brief-narrative-coaching.ts) carries the pick's strike as a real
    // number; using it only when it parses keeps the corroboration case (which already names its
    // one shared strike) and the never-fabricate discipline this section already follows for its
    // sibling absence cases — a play with no resolvable OCC still gets the honest, pre-existing
    // generic line rather than a guessed number.
    const ownStrike = parseOccSymbol(play.occ ?? null)?.strike;
    lines.push(
      matchedPick
        ? `**Strike vs flow:** this contract's strike (**$${topFlowStrike}**) matches the accumulation flow's own magnet strike — corroborating.`
        : ownStrike != null
          ? `**Strike vs flow:** the accumulation flow's magnet strike was **$${topFlowStrike}**; this pick used **$${ownStrike}** instead (chosen independently on tradability/fit).`
          : `**Strike vs flow:** the accumulation flow's magnet strike was **$${topFlowStrike}**; this pick landed at a different strike (chosen independently on tradability/fit).`,
    );
  }
  // "Today's regime read" (not the old bare "Discovery read") — `play.regime` is re-derived FRESH on
  // every scan (attachThesisExplanation, serving-lane.ts) while `play.archetype` right above stays
  // PINNED from commit day. The two are independent classifier reads of the same dossier at different
  // times and can genuinely diverge without either being wrong (live repro 2026-09-14, KR: pinned
  // Archetype "Breakout continuation" next to a fresh regime read of "Event-driven directional" with
  // no framing — read as an internal contradiction in the same document). The label now states which
  // one is current, so two different labels read as "thesis has evolved," not "this brief is broken."
  if (play.regime) lines.push(`**Today's regime read:** ${play.regime}`);
  if (play.sectorLeadershipFacts) {
    const f = play.sectorLeadershipFacts;
    // BUG FOUND (Ask Largo standing mandate, 2026-09-22, follow-up to #5446): `sectorLeadershipFacts`
    // is frozen into the dossier at commit/discovery time and never re-derived (active-refresh.ts only
    // refreshes live price/manage state, never re-runs buildSwingDossier) — so a position committed
    // BEFORE #5446 shipped can still carry a pre-fix benchmark for a name #5446 now excludes entirely
    // (a crypto-equity ticker mechanically resolved against a SIC/label-derived sector ETF, e.g. HUT
    // vs Financials/XLF). Rewriting the frozen evidence live would misrepresent why the play actually
    // scored what it did at commit (the same "grade against what was known at the time" principle the
    // calibration/track-record machinery already depends on) — so this checks the EXACT, narrow bug
    // signature #5446 fixed (a name whose theme is now excluded from benchmarking, but whose frozen
    // facts still carry one) and discloses it instead of silently repeating a claim now known false.
    // Mirrors the `statusBucket(play)==="closed"` disclosure pattern in `flowIntelSection` (#5444) —
    // same "disclose, don't silently rewrite" shape, gated on a different, narrower condition.
    const staleBenchmark = NO_SECTOR_BENCHMARK_THEMES.has(sectorFor(play.ticker) ?? "");
    if (staleBenchmark) {
      lines.push(
        "**Industry read:** sector benchmark evidence recorded before a classification fix — historical score unaffected.",
      );
    } else {
      const verb = f.deltaPct >= 0 ? "leading" : "lagging";
      // BUG FIX (Ask Largo standing mandate, 2026-10-09): this used to round `f.deltaPct` (the raw,
      // unrounded nameReturnPct − groupReturnPct) to 1dp INDEPENDENTLY of the 1dp-rounded
      // `fmtPct(nameReturnPct)`/`fmtPct(groupReturnPct)` shown right beside it — the same
      // independently-rounded-related-quantities precision bug `fmtPct`'s and `fmtPriceLevel`'s own
      // headers already name as a recurring class here (C9), just not yet caught at THIS call site.
      // Live repro (2026-10-09, real AAPL WATCH brief): "lagging Technology (XLK) by 0.2% over 10
      // sessions (+1.3% vs +1.6%)" — a member doing the subtraction themselves from the two
      // displayed numbers gets 1.6 − 1.3 = 0.3, not the stated 0.2; raw nameReturnPct=1.34,
      // groupReturnPct=1.55 reproduces it exactly (raw delta −0.21 rounds to "0.2" alone, while each
      // operand independently rounds to 1.3/1.6, which subtract to 0.3). Fix: round the two operands
      // ONCE (the same rounding `fmtPct` applies) and derive the displayed delta from THOSE rounded
      // values, never from the raw delta — guarantees "by X%" always equals the subtraction a reader
      // does from the two numbers right next to it. The second `Math.round(... * 10) / 10` after
      // subtracting is not a second independent rounding, just float-noise cleanup (1.6 − 1.3 ===
      // 0.2999999999999998 in IEEE 754) before `.toFixed(1)` would otherwise need to re-round it.
      const roundedName = Math.round(f.nameReturnPct * 10) / 10;
      const roundedGroup = Math.round(f.groupReturnPct * 10) / 10;
      const roundedDelta = Math.round((roundedName - roundedGroup) * 10) / 10;
      lines.push(
        `**Industry read:** ${verb} **${f.benchmarkLabel}** (${f.benchmarkEtf}) by ${Math.abs(roundedDelta).toFixed(1)}% ` +
          `over 10 sessions (${fmtPct(f.nameReturnPct)} vs ${fmtPct(f.groupReturnPct)}).`,
      );
    }
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

  // BUG FIX (2026-10-21, Ask Largo round-3 deep-dive, live repro TSLA WATCH): for the WATCH bucket,
  // watchEntrySection (play-brief.ts) already renders these identical two TerminalPlay fields —
  // servingSection/setupState — as "Serving section"/"Setup" in the Entry section composeSwingPlayBrief
  // always places immediately before this one, so restating them here is a pure duplicate (not merely
  // a different label, the SAME section pair always appears together for a WATCH play). For every
  // bucket, `setupState` could ALSO already be folded into the lede sentence above (synthesizedSetupLede)
  // — restating it a second time in the SAME section is the "lede subsumes, never duplicates" bug this
  // function's own existing tests (ledeFoldsNotDuplicates) already require for the Signals/Archetype
  // lines, just missed here.
  if (bucket !== "watch") {
    if (play.servingSection) {
      lines.push(`Desk section: **${play.servingSection.replace(/_/g, " ")}**`);
    }
    if (play.setupState && !lede) lines.push(`Setup maturity: **${play.setupState}**`);
  }

  return { title: "Why this setup", body: lines.join("\n\n") };
}

/**
 * Book context — does this candidate stack or fight a theme the member already holds elsewhere?
 * Reuses the same theme resolver the swing entry gate itself uses (`portfolio.ts`/`theme-cluster.ts`,
 * SEV-9), so this reports the SAME partition the gate would flag — not a second, diverging notion
 * of "similar." Only rendered when the book actually overlaps; a clean book says nothing new.
 *
 * CLOSED-bucket guard (FINDINGS 2026-09-12): this section's copy is written in the present/future
 * tense of a PENDING entry decision — "Adding {ticker} stacks the same wager..." — which is the
 * right frame for a WATCH candidate (there IS a decision to make: enter or pass). A CLOSED position
 * has no such decision left; live-repro on a real closed AAPL brief (positionId 36, exited
 * 2026-09-04) rendered "Book context: ... Adding AAPL stacks the same wager..." against the CURRENT
 * book (which happens to hold a live AAPL long entered a week later) — confusing a member reviewing
 * a historical trade into thinking this is live guidance about a decision they're about to make,
 * when it is neither about THAT trade (already closed) nor actionable going forward from this
 * brief. Gated out entirely rather than reworded past-tense: "book overlap at review time" isn't a
 * fact about the closed trade being reviewed, so it doesn't belong on this bucket's brief at all —
 * `archetypeTrackRecordSection` already carries the legitimate "how did trades like this one do"
 * retrospective for CLOSED.
 *
 * ALREADY-OPEN wording fix (FINDINGS 2026-09-12, second instance of the same tense bug): an
 * OPEN/HOLD/TRIM position is not a pending entry decision either — the position already exists.
 * Live-repro on a real TRIM/EXIT_RUNNER CRWD brief (positionId 19): "Adding CRWD stacks the same
 * wager rather than diversifying risk" rendered on a position the desk was actively telling members
 * to TRIM OUT, not add to — there is no "adding" decision on the table for an already-committed,
 * being-reduced position. Unlike the CLOSED case, the overlap fact is still live and relevant here
 * (the position IS open, the book overlap IS real right now), so this stays rendered — only the
 * "Adding..." phrasing changes to reflect existing exposure rather than a forward decision.
 */
/**
 * Largo C4 (2026-09-15, Ask Largo standing mandate): `loadOpenBook()` merges TWO ledgers
 * (`swing_positions`, real `positionId`; `banger_positions`, `positionId` deliberately left unset
 * — the two tables are separate DB sequences that can collide on numeric id). Once a reviewed
 * play's own `positionId` is known, `checkPortfolioOverlap` can only exclude an exact id match —
 * a genuine cross-engine sibling on the SAME ticker (banger's positionId is always unset, so it
 * can never match) correctly falls through as real concentration, not a bug. But rendered as bare
 * "TICKER DIRECTION" it is textually indistinguishable from a self-citation/duplication defect —
 * live-confirmed on CRWD (swing position #39 correctly excluded; a real, independently-committed
 * Banger CRWD LONG, id 1123, 255C, still renders as unlabeled "CRWD LONG" in its own overlap list).
 * Distinguishing detail (a positionId when known, else a "cross-engine" tag) removes the ambiguity
 * without widening `PortfolioPosition`'s intentionally minimal shape (ticker+direction+positionId?).
 *
 * BUG FOUND (2026-09-18, Ask Largo standing mandate): the "cross-engine" tag above has no way to
 * distinguish MULTIPLE such siblings from each other, and that's not hypothetical — live repro,
 * CRWD:39's own brief today: TWO real, independently-committed Banger CRWD LONG positions both
 * rendered the IDENTICAL "CRWD LONG (separate, cross-engine position)" text in the same
 * concentration list, reading exactly like a duplicate-counting defect (the same shape the
 * 2026-09-15 fix above was written to prevent) even though the underlying count was honest — two
 * genuinely different rows, confirmed via `fetchBangerOpenBookRows` (status IN OPEN/PARTIAL, no DTE
 * filter) carrying both while the horizons board's own DTE-windowed display
 * (`horizonPlayFromBangerPosition`) happened to show neither at the moment checked, which is why a
 * board-only scan for "other CRWD rows" found none despite two real ones existing. `bangerId`
 * (portfolio.ts, display-only, never touching the exclude/match logic) now carries the real
 * banger_positions row id for exactly this case.
 */
/**
 * GAP FOUND (2026-09-20, Ask Largo standing mandate, live repro RIOT's own book-context): the
 * 2026-09-15/09-18 fixes above only ever disambiguate the REVIEWED play's own ticker appearing
 * twice in its own overlap list — they never considered a DIFFERENT ticker appearing twice in
 * SOMEONE ELSE's overlap list, which is exactly as reachable and reads exactly as suspicious. Live:
 * RIOT's concentration line (11-position crypto-equity book) cited "...IREN LONG, COIN LONG, MSTR
 * LONG, MSTX LONG" with MSTX ALSO appearing earlier in the same list ("...MSTX LONG, MSTU LONG...")
 * — two genuinely separate MSTX positions (a swing-native promoted row plus a distinct banger-
 * engine sibling, the same real cross-engine-duplication shape the 2026-09-18 fix already handles
 * for the SELF-ticker case), rendered as two textually identical "MSTX LONG" strings with no
 * distinguishing detail, because neither one is the ticker being reviewed (RIOT) so the existing
 * `p.ticker !== reviewedTicker` early-return skipped disambiguation for both.
 *
 * Fix: disambiguate whenever a ticker appears MORE THAN ONCE within the SAME rendered list
 * (`dupTickers`, computed per-list by the caller) — additive to, not a replacement for, the
 * existing "this is the reviewed ticker" rule, which must keep disambiguating on its own even when
 * count is exactly 1 (a single cross-engine sibling on the reviewed ticker still reads as
 * self-citation-like, per the 2026-09-15 fix's own reasoning — unrelated to duplicate counting).
 */
function formatOverlapPosition(
  p: PortfolioPosition,
  reviewedTicker: string,
  dupTickers: ReadonlySet<string>,
  reviewedIsBangerOrigin: boolean,
  crossEngineDupTickers: ReadonlySet<string>,
): string {
  // BUG FIX (2026-10-17, Ask Largo standing mandate, live repro ALAB: "Internal conflict — SQQQ
  // LONG, SOXS LONG" rendered right next to a "Concentration — NVDA LONG, CRWV LONG" sentence, with
  // no visible reason why two "LONG" rows land in the OPPOSED bucket). `checkPortfolioOverlap`
  // already classifies correctly off `effectiveDirection` (SOXS/SQQQ's real economic bet is the
  // OPPOSITE of their nominal long/short field — theme-cluster.ts's `INVERSE_LEVERAGE_ETFS`), but
  // this renderer only ever printed the raw, nominal direction — so the classification was right
  // and the sentence explaining it read as self-contradictory. Annotate with the real bet so the
  // "LONG...OPPOSED" pairing is self-explanatory instead of requiring the reader to already know
  // which tickers are inverse-leveraged.
  const base = isInverseLeverageEtf(p.ticker)
    ? `${p.ticker} ${p.direction} (inverse ETF — economically ${effectiveDirection(p.ticker, p.direction)})`
    : `${p.ticker} ${p.direction}`;
  const isReviewedTicker = p.ticker.toUpperCase() === reviewedTicker.toUpperCase();
  const isDuplicateOtherTicker = !isReviewedTicker && dupTickers.has(p.ticker.toUpperCase());
  if (!isReviewedTicker && !isDuplicateOtherTicker) return base;
  if (p.positionId != null) return `${base} (separate position #${p.positionId})`;
  // BUG FIX (2026-10-20, Ask Largo standing mandate, live repro LABD #1955/#1761 and RNG #1966/
  // #1902): a null `p.positionId` means THIS sibling is Banger-origin (per loadOpenBook's own
  // convention, play-brief-context.ts) — but that alone doesn't make the relationship "cross-
  // engine". It's cross-engine only when the REVIEWED play is a DIFFERENT engine from this
  // sibling. When the reviewed play is ALSO Banger-origin, both sides are the same engine
  // committing to the same ticker twice, and "cross-engine" is simply false — live-reproduced:
  // LABD positionId 1955's Book Context cited "#1761" as "cross-engine" and 1761's own brief
  // symmetrically cited "#1955" the same way, yet both are confirmed BANGER_LEDGER_REGIME_LABEL
  // rows (same engine). This matters because "cross-engine" reads as a stronger, more
  // independently-corroborated signal (two separate systems both like this ticker) than "same
  // engine, same ticker, twice" (a narrower, single-source signal) — and 21 of 26 live committed
  // Swing positions the day this was found were Banger-origin, so same-ticker Banger/Banger pairs
  // are common, not an edge case.
  //
  // BUG FIX (Ask Largo standing mandate, 2026-10-20, live repro RIOT reviewing a duplicate OTHER
  // ticker MSTX): the line above answers "is THIS sibling cross-engine relative to the REVIEWED
  // play" — sound for `isReviewedTicker` (both rows share the reviewed ticker, so that comparison
  // IS the cross-engine question), but wrong for `isDuplicateOtherTicker`: those two duplicate rows
  // belong to some OTHER ticker entirely, so whether THEY are cross-engine to EACH OTHER has
  // nothing to do with whether the REVIEWED ticker happens to be Banger-origin. Two Banger-origin
  // MSTX rows duplicated in RIOT's list were falsely labeled "cross-engine" solely because RIOT
  // itself was swing-native — the exact mislabeling the 2026-10-17 fix above was written to stop,
  // just reached from the other ticker. `crossEngineDupTickers` (computed by the caller from the
  // SAME rendered list, scoped the same way `dupTickers` already is) answers the right question for
  // this branch: does THIS ticker's own duplicate group actually mix a native swing row with a
  // Banger row.
  const isCrossEngine = isReviewedTicker
    ? !reviewedIsBangerOrigin
    : crossEngineDupTickers.has(p.ticker.toUpperCase());
  if (!isCrossEngine) {
    return p.bangerId != null
      ? `${base} (separate position #${p.bangerId})`
      : `${base} (separate position)`;
  }
  return p.bangerId != null
    ? `${base} (separate, cross-engine position #${p.bangerId})`
    : `${base} (separate, cross-engine position)`;
}

/** Tickers that appear more than once in `positions` — the set `formatOverlapPosition` needs to
 *  disambiguate a genuine duplicate that is NOT the reviewed ticker (see that function's doc). */
function tickersAppearingMoreThanOnce(positions: readonly PortfolioPosition[]): ReadonlySet<string> {
  const counts = new Map<string, number>();
  for (const p of positions) {
    const key = p.ticker.toUpperCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const dup = new Set<string>();
  for (const [ticker, count] of counts) {
    if (count > 1) dup.add(ticker);
  }
  return dup;
}

/** Tickers whose SAME-ticker duplicate group (within `positions`) mixes a native swing row
 *  (`positionId` set) with a Banger-origin row (`positionId` null — `loadOpenBook`'s own
 *  convention). This is the only shape that makes a duplicate-OTHER-ticker pair genuinely
 *  cross-engine for `formatOverlapPosition`'s `isDuplicateOtherTicker` branch — two Banger rows of
 *  the same ticker are the same engine committing twice, not two independent engines; a row
 *  carrying `positionId` already short-circuits to its own "(separate position #N)" branch before
 *  this set is ever consulted, so only Banger-origin duplicates reach it in practice. */
function tickersWithMixedOriginDuplicates(positions: readonly PortfolioPosition[]): ReadonlySet<string> {
  const hasNativeRow = new Set<string>();
  const hasBangerRow = new Set<string>();
  for (const p of positions) {
    const key = p.ticker.toUpperCase();
    if (p.positionId != null) hasNativeRow.add(key);
    else hasBangerRow.add(key);
  }
  const mixed = new Set<string>();
  for (const ticker of hasBangerRow) {
    if (hasNativeRow.has(ticker)) mixed.add(ticker);
  }
  return mixed;
}

/**
 * GAP FOUND (2026-09-20, Ask Largo standing mandate, live repro BKKT's own book-context, 28-name
 * overlap in a crowded "crypto-equity" book): every fix above disambiguates INDIVIDUAL names, but
 * nothing ever capped how MANY of them get joined into one prose sentence. A same-theme book that
 * has grown past ~8-10 positions (routine here — the live crypto-equity cluster alone was 28 deep)
 * renders as one unbroken comma-separated wall of tickers, which is exactly the "bullet-dump
 * instead of trade-manager voice" failure mode the Largo product contract's narrative principle
 * exists to prevent — a trader cannot usefully scan 28 names in a sentence, and the ones that would
 * matter most (this exact ticker's own cross-engine sibling, a duplicate) are buried mid-list no
 * differently than the 20th unrelated name. Fix: cap the rendered names at `MAX_OVERLAP_NAMES` and
 * fold the rest into a plain count ("+ N more") — the underlying overlap COUNT in the lead sentence
 * (`overlap.sameThemeSameDirection.length`) already states the true total honestly, so nothing is
 * hidden, only the exhaustive namewall is trimmed. Disambiguation (`dupTickers`) is still computed
 * over the FULL list before truncation, so a duplicate that happens to fall past the cap is still
 * correctly resolved for every name that IS shown.
 */
const MAX_OVERLAP_NAMES = 8;

function joinOverlapNames(names: readonly string[]): string {
  if (names.length <= MAX_OVERLAP_NAMES) return names.join(", ");
  const shown = names.slice(0, MAX_OVERLAP_NAMES);
  const remaining = names.length - MAX_OVERLAP_NAMES;
  return `${shown.join(", ")}, + ${remaining} more`;
}

export function bookContextSection(
  play: TerminalPlay,
  openBook: PortfolioPosition[] | null | undefined,
): RichSection | null {
  if (play.status === "CLOSED") return null;
  if (openBook == null || !openBook.length) return null;
  const { positionId } = parseSwingPlayId(play.id);
  const isPendingEntryDecision = play.status === "WATCH";
  // GAP FOUND (2026-09-21, Ask Largo standing mandate, live repro: a WATCH candidate on a ticker
  // the trader already holds LONG). WATCH plays never carry a ledger positionId (play.id is only
  // ever stamped `${horizon}:${ticker}${positionId ? ":"+positionId : ""}` -- see
  // banger-lane-merge.ts's own comment), so `positionId` is null here and this call used to fall
  // through to `checkPortfolioOverlap`'s DEFAULT `excludeSelfMatch: true`. That default's whole
  // job (per portfolio.ts's own doc comment) is to drop the "this IS the reviewed position itself"
  // row for an ALREADY-COMMITTED play being re-read from its own book -- portfolio.ts's own docs
  // say so explicitly: "Gate callers evaluating an uncommitted dossier should pass false so a lone
  // pre-existing same-ticker/same-direction row is counted as concentration." A WATCH candidate IS
  // exactly that uncommitted-dossier case, but this call never passed it -- so a trader looking at
  // a WATCH signal for a ticker they already hold LONG saw the pre-existing position silently
  // treated as "self" and NO concentration warning at all, the precise "you're about to double an
  // identical wager" scenario this whole section exists to flag. Fix: pass `excludeSelfMatch:
  // false` whenever there is no real ledger id to exclude by AND the play is still a pending entry
  // decision -- a matching row in the book can only be a genuine distinct position in that case,
  // never "the candidate re-reading itself". Left the old default (`undefined`, i.e.
  // `excludeSelfMatch: true`) for the positionId-unknown-but-NOT-WATCH edge case, since there the
  // row really could be the candidate's own already-committed self under a stale/missing id.
  const overlap = checkPortfolioOverlap(
    { ticker: play.ticker, direction: play.direction },
    openBook,
    positionId != null
      ? { excludePositionId: positionId }
      : isPendingEntryDecision
        ? { excludeSelfMatch: false }
        : undefined,
  );
  if (!overlap.hasOverlap) return null;

  const reviewedIsBangerOrigin = play.regime === BANGER_LEDGER_REGIME_LABEL;
  const lines: string[] = [];
  if (overlap.sameThemeSameDirection.length) {
    const dupTickers = tickersAppearingMoreThanOnce(overlap.sameThemeSameDirection);
    const crossEngineDupTickers = tickersWithMixedOriginDuplicates(overlap.sameThemeSameDirection);
    // BUG FIX (2026-10-21, Ask Largo standing mandate): this branch never sharpened the case where
    // one of the overlapping rows is the LITERAL SAME TICKER as the reviewed play — it rendered
    // with generic "theme X" framing identical to a genuinely different name in that theme.
    // `describeThemeOverlap` only produces "the same name" framing when the candidate's theme
    // ITSELF is an own-cluster sentinel (no other ticker shares it) — it does not detect a
    // same-ticker row sitting INSIDE a real, multi-name theme (e.g. "healthcare", "semis"). The
    // OPPOSED-direction branch a few lines below already special-cases this exact shape (dated
    // 2026-10-20, live TSLA repro) via an identical same-ticker/other-ticker split — this mirrors
    // it for the same-direction side. portfolio.ts's own design-intent comment calls two
    // independent same-ticker/same-direction positions "the most extreme concentration case this
    // function exists to catch," yet the rendering treated it identically to ordinary cross-ticker
    // sector concentration. Live repro: MRNA TRIM (positionId 1958) read "already holding 1
    // same-direction position in theme 'healthcare': MRNA LONG (separate position #1969)" — the
    // ENTIRE "theme overlap" was a second, independently-committed MRNA position, not a different
    // healthcare name, yet framed as sector-level diversification failure.
    const reviewedTickerUpper = play.ticker.trim().toUpperCase();
    const sameTickerSameDir = overlap.sameThemeSameDirection.filter(
      (p) => p.ticker.trim().toUpperCase() === reviewedTickerUpper,
    );
    const otherSameDir = overlap.sameThemeSameDirection.filter(
      (p) => p.ticker.trim().toUpperCase() !== reviewedTickerUpper,
    );
    if (sameTickerSameDir.length) {
      const sameTickerNames = joinOverlapNames(
        sameTickerSameDir.map((p) =>
          formatOverlapPosition(p, play.ticker, dupTickers, reviewedIsBangerOrigin, crossEngineDupTickers),
        ),
      );
      // Same pending-entry-vs-already-committed tense distinction the generic branch below
      // (and siblingPositionsNote) already carry — a WATCH candidate hasn't entered yet ("Adding"),
      // an already-open/HOLD/TRIM position already has (no "Adding").
      const closer = isPendingEntryDecision
        ? `Adding ${play.ticker} stacks the identical wager twice, not diversifying across names.`
        : `${play.ticker} stacks the identical wager twice, not diversifying across names.`;
      lines.push(
        `**Concentration — same underlying** — already holding ${sameTickerNames} on ${play.ticker} itself, ` +
          `the same side as this ${play.direction} candidate. This is the identical name, not just the same ` +
          `sector. ${closer}`,
      );
    }
    if (otherSameDir.length) {
      const names = joinOverlapNames(
        otherSameDir.map((p) =>
          formatOverlapPosition(p, play.ticker, dupTickers, reviewedIsBangerOrigin, crossEngineDupTickers),
        ),
      );
      const closer = isPendingEntryDecision
        ? `Adding ${play.ticker} stacks the same wager rather than diversifying risk.`
        : `${play.ticker} stacks the same wager rather than diversifying risk.`;
      lines.push(
        `**Concentration** — already holding ${otherSameDir.length} same-direction ` +
          `position${otherSameDir.length > 1 ? "s" : ""} in ${describeThemeOverlap(overlap.theme)}: ${names}. ` +
          closer,
      );
    }
  }
  if (overlap.sameThemeOpposedDirection.length) {
    const dupTickers = tickersAppearingMoreThanOnce(overlap.sameThemeOpposedDirection);
    // Scoped over the FULL opposed list, same as `dupTickers` just above — see that function's own
    // doc comment for why the duplicate-ticker question is answered over the whole rendered list,
    // not a post-split sub-slice.
    const crossEngineDupTickers = tickersWithMixedOriginDuplicates(overlap.sameThemeOpposedDirection);
    // GAP FOUND (Ask Largo standing mandate, 2026-10-20, live repro: TSLA 385P SHORT candidate,
    // book already holding a real TSLA 352.5C LONG). `describeThemeOverlap` only sharpens to "the
    // same name" when the candidate's THEME ITSELF is an own-cluster sentinel (theme-cluster.ts) —
    // i.e. the candidate ticker has no resolved sector theme at all. TSLA resolves to a real,
    // multi-name theme ("ev-auto"), so an opposed row that happens to be the LITERAL SAME TICKER
    // as the candidate (not just the same sector) rendered with identical framing to a genuinely
    // different name in the same theme (TSLL) — "theme 'ev-auto' already has an OPPOSED position:
    // TSLA LONG (separate position #60), TSLL LONG." `formatOverlapPosition` already annotates the
    // same-ticker row with "(separate position #N)", but that is one parenthetical among several
    // names in a generic theme sentence — a trader can read past it. A same-ticker opposed
    // position is a sharper signal than a same-sector one (holding TSLA both LONG and SHORT is
    // mechanically self-defeating regardless of thesis; holding TSLA LONG and TSLL SHORT is a real,
    // if aggressive, sector-divergence bet) — split it into its own louder sentence.
    const reviewedTickerUpper = play.ticker.trim().toUpperCase();
    const sameTickerOpposed = overlap.sameThemeOpposedDirection.filter(
      (p) => p.ticker.trim().toUpperCase() === reviewedTickerUpper,
    );
    const otherOpposed = overlap.sameThemeOpposedDirection.filter(
      (p) => p.ticker.trim().toUpperCase() !== reviewedTickerUpper,
    );
    if (sameTickerOpposed.length) {
      const sameTickerNames = joinOverlapNames(
        sameTickerOpposed.map((p) =>
          formatOverlapPosition(p, play.ticker, dupTickers, reviewedIsBangerOrigin, crossEngineDupTickers),
        ),
      );
      lines.push(
        `**Internal conflict — same underlying** — already holding ${sameTickerNames} on ${play.ticker} itself, ` +
          `the opposite side of this ${play.direction} candidate. This is the identical name, not just the same ` +
          `sector — one of these two positions is mechanically wrong.`,
      );
    }
    if (otherOpposed.length) {
      const names = joinOverlapNames(
        otherOpposed.map((p) =>
          formatOverlapPosition(p, play.ticker, dupTickers, reviewedIsBangerOrigin, crossEngineDupTickers),
        ),
      );
      lines.push(
        `**Internal conflict** — ${describeThemeOverlap(overlap.theme)} already has an OPPOSED position: ${names}. ` +
          `One leg is structurally betting against the other; this is not a hedge unless intentional.`,
      );
    }
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
 * Also cites the SUB-LANE dimension (TACTICAL 5-7d vs STANDARD 8-21d — `snapshot.subLanes`,
 * distilled by the same cron tick) as an ADDITIONAL paragraph when that bucket has independently
 * graduated, rather than as a follow-up left unshipped: this previously stopped at the archetype
 * dimension alone ("combining two graduated dimensions... is left as a follow-up") but
 * `graduatedSubLaneEntry` was fully built, wired write-side every cron tick, and unit-tested with
 * zero read-side call sites — a real, if honest, gap once the archetype citation had been live long
 * enough to prove the pattern out. Deliberately does NOT merge the two into one blended stat (that
 * would double-count the same underlying graded rows across two overlapping cuts of the same
 * population); it cites them as two separate, independently-gated evidence lines, each honestly
 * omitted on its own if its own bucket hasn't graduated — the archetype line can render alone, the
 * sub-lane line can render alone, both can render, or (most common while the closed-swing
 * population is still small) neither can.
 *
 * STRUCTURED FORM (Largo C10, follow-up — Ask Largo standing mandate): the prose above and the
 * `evidence[]` fact `play-brief.ts` separately stamps (search "Largo C10 (historical context)
 * enhancement") both carry these same numbers only as a formatted TEXT string with provenance —
 * citable, but a consumer still has to parse/regex the string to recover the discrete wins/losses/
 * n/winRatePct/wilsonLbPct/pointDeltaPts values. `BieSection.table` (answer-envelope.ts) is the
 * established, already-rendered (`renderEnvelopeMarkdown`/`dynamic-format.ts`) mechanism this
 * contract already has for exactly that — genuinely structured, directly-bindable rows — it was
 * simply never wired through `RichSection`/`buildRichEnvelope` (the shared layer every
 * deterministic composer routes through) until now. Attached ADDITIVELY alongside `body`: the
 * prose is unchanged, a consumer that ignores `table` sees nothing different.
 */
function trackRecordTableRow(
  scope: string,
  entry: SwingTrackRecordEntry,
): [string, string, string, string, string, string] {
  return [
    scope,
    `${entry.wins}W / ${entry.losses}L`,
    String(entry.n),
    entry.winRatePct != null ? `${entry.winRatePct.toFixed(0)}%` : "—",
    `${entry.wilsonLbPct.toFixed(0)}%`,
    entry.pointDeltaPts != null ? `+${entry.pointDeltaPts.toFixed(0)} pts` : "—",
  ];
}

export function archetypeTrackRecordSection(
  play: TerminalPlay,
  snapshot: SwingArchetypeTrackRecordSnapshot | null | undefined,
  readMs: number = Date.now(),
): RichSection | null {
  const archetype = (SWING_ARCHETYPES as readonly string[]).includes(play.archetype ?? "")
    ? (play.archetype as (typeof SWING_ARCHETYPES)[number])
    : null;
  const archetypeEntry = graduatedArchetypeEntry(snapshot, archetype);

  const subLane = (SWING_SUB_LANES_ORDER as readonly string[]).includes(play.subLane ?? "")
    ? (play.subLane as (typeof SWING_SUB_LANES_ORDER)[number])
    : null;
  const subLaneEntry = graduatedSubLaneEntry(snapshot, subLane);

  if (!archetypeEntry && !subLaneEntry) return null;

  const blocks: string[] = [];
  const rows: [string, string, string, string, string, string][] = [];
  if (archetypeEntry && archetype) {
    const label = ARCHETYPE_META[archetype].label;
    const sampleNote =
      archetypeEntry.tier === "BROAD" ? "broad sample" : "limited sample — still evidence, not vibes";
    const lines: string[] = [
      `**${label}** — ${archetypeEntry.wins}W / ${archetypeEntry.losses}L across **${archetypeEntry.n}** graded plays (${sampleNote}).`,
      `Raw win rate **${archetypeEntry.winRatePct != null ? `${archetypeEntry.winRatePct.toFixed(0)}%` : "—"}** · Wilson 95% lower bound **${archetypeEntry.wilsonLbPct.toFixed(0)}%** — the conservative floor this evidence actually supports, not the point estimate.`,
    ];
    if (archetypeEntry.pointDeltaPts != null) {
      lines.push(
        `Clears this archetype's provisional score floor by **+${archetypeEntry.pointDeltaPts.toFixed(0)} pts** win-rate edge vs setups that did not.`,
      );
    }
    blocks.push(lines.join("\n"));
    rows.push(trackRecordTableRow(label, archetypeEntry));
  }
  if (subLaneEntry && subLane) {
    const label = SWING_SUB_LANES[subLane].label;
    const sampleNote =
      subLaneEntry.tier === "BROAD" ? "broad sample" : "limited sample — still evidence, not vibes";
    const lines: string[] = [
      `**${label} sub-lane** — ${subLaneEntry.wins}W / ${subLaneEntry.losses}L across **${subLaneEntry.n}** graded plays (${sampleNote}).`,
      `Raw win rate **${subLaneEntry.winRatePct != null ? `${subLaneEntry.winRatePct.toFixed(0)}%` : "—"}** · Wilson 95% lower bound **${subLaneEntry.wilsonLbPct.toFixed(0)}%**.`,
    ];
    if (subLaneEntry.pointDeltaPts != null) {
      lines.push(
        `Clears this sub-lane's provisional score floor by **+${subLaneEntry.pointDeltaPts.toFixed(0)} pts** win-rate edge vs setups that did not.`,
      );
    }
    blocks.push(lines.join("\n"));
    rows.push(trackRecordTableRow(`${label} sub-lane`, subLaneEntry));
  }
  // BUG FIX (Ask Largo standing mandate, 2026-10-15): `snapshot.gradedPlays` — the whole-lane
  // graded-play count at write time, documented on the type itself as existing specifically to
  // give "context for how broad the evidence base is overall, independent of any one bucket's own
  // n" — was computed and threaded all the way to this function, which received the full
  // `snapshot` object, but only ever forwarded it into `graduatedArchetypeEntry`/
  // `graduatedSubLaneEntry` and never read it directly. A member reading "across 12 graded plays"
  // on a thin archetype bucket had no way to tell that was 12 of a lane with (say) 70 total graded
  // plays vs 12 of a lane with only 15 — the exact context this field exists to supply.
  if (snapshot) {
    blocks.push(`*Across ${snapshot.gradedPlays} lane-wide graded plays as of this read.*`);
    // BUG FIX (Ask Largo standing mandate, 2026-10-20): this section rendered the win-rate/Wilson-LB
    // numbers above with ZERO age disclosure, unlike every sibling section in this file (Vector,
    // GEX, Meridian, dark-pool, option mark all render an explicit "last synced"/staleness line) —
    // even though `snapshot.asOf` (documented on the type as "Largo C1/C2 provenance") was
    // available the whole time. Mirrors the option-mark pattern exactly: only call out staleness
    // when it's genuine (`archetypeTrackRecordIsStale`, the same cadence-aware check now used for
    // this fact's evidence[] entry), never for an on-schedule read.
    const syncedAt = etStampFromIso(snapshot.asOf);
    if (syncedAt) {
      blocks.push(
        archetypeTrackRecordIsStale(snapshot.asOf, readMs)
          ? `Track record data **stale** — last synced **${syncedAt}**.`
          : `Track record data as of **${syncedAt}**.`,
      );
    }
  }
  return {
    title: "Track record",
    body: blocks.join("\n\n"),
    bias: "neutral",
    table: { headers: ["Scope", "Record", "N", "Win rate", "Wilson LB", "Edge"], rows },
  };
}

/**
 * Ticker track record — cites the ticker's OWN prior trade history (Largo product contract C10,
 * "historical context"), the sibling of `archetypeTrackRecordSection` above scoped to TICKER
 * rather than ARCHETYPE (play-brief-ticker-history.ts's file header has the full gap this closes:
 * the archetype section's own cache is explicitly "not keyed by TICKER at all"). Unlike the
 * archetype section, this is a plain factual count with no statistical graduation gate — there is
 * no calibrated score being compared cross-product here, so the Largo C6 confidence-omission
 * principle governing `archetypeTrackRecordSection` doesn't apply; omission here is purely about
 * absence of data (zero prior resolved trades on this ticker), never about withholding evidence
 * that exists but isn't yet trustworthy enough to cite.
 *
 * Carries the same structured `table` as `archetypeTrackRecordSection` above, for the same reason
 * (Largo C10 follow-up — a joinable row, not just a parsed string).
 */
export function tickerTrackRecordSection(
  play: TerminalPlay,
  record: SwingTickerTrackRecord | null | undefined,
): RichSection | null {
  if (!record || record.priorClosedTrades <= 0) return null;
  const { ticker, priorClosedTrades, wins, losses } = record;
  const plural = priorClosedTrades === 1 ? "time" : "times";
  const winRatePct = priorClosedTrades > 0 ? Math.round((wins / priorClosedTrades) * 100) : null;
  // BUG FIX (Ask Largo standing mandate, 2026-10-15): `record.directions` is computed and
  // populated unconditionally by play-brief-ticker-history.ts specifically so a caller can "tell
  // whether the cited record actually shares the reviewed play's direction before implying it's a
  // directly comparable 'no edge on this setup' verdict" (that file's own doc comment) — the exact
  // precision gap play-brief-narrative-coaching.ts's tickerHistoryCoaching() already guards
  // against for its OWN "Trade manager read" mention of this same record, but this dedicated
  // section/table (the one place a member sees the bare count with no qualifier at all) never did.
  // A 0W/2L record built entirely from SHORT trades says nothing about today's LONG thesis on the
  // same ticker — stating the bare count without this disclosure implies a comparability the data
  // doesn't have (Largo C9 precision). Wording only; the count itself never changes.
  const playDirection = play.direction.toLowerCase();
  const directions = record.directions;
  const allSameDirection = directions != null && directions.length > 0 && directions.every((d) => d === playDirection);
  const directionNote =
    directions != null && directions.length > 0 && !allSameDirection
      ? ` (${new Set(directions).size > 1 ? "mixed long/short" : `all ${directions[0]}`} — not all directly comparable to today's ${play.direction} setup)`
      : "";
  const lines = [
    `The desk has traded **${ticker}** **${priorClosedTrades}** ${plural} before this play: **${wins}W / ${losses}L**` +
      (winRatePct != null ? ` (${winRatePct}% win rate on this ticker specifically)${directionNote}.` : `${directionNote}.`),
  ];
  return {
    title: "Ticker track record",
    body: lines.join("\n\n"),
    bias: "neutral",
    table: {
      headers: ["Ticker", "Record", "N", "Win rate"],
      rows: [[ticker, `${wins}W / ${losses}L`, String(priorClosedTrades), winRatePct != null ? `${winRatePct}%` : "—"]],
    },
  };
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

  // BUG FIX (Ask Largo standing mandate, 2026-10-15): `v.absent` (which sources couldn't answer
  // this turn — the Largo C3 absence principle) was computed and pinned on every verdict this
  // section already reads, but never surfaced here — unlike every other verdict-to-prose renderer
  // of this exact CortexVerdict type (bie/cortex-read.ts's assembleVerdictEnvelope/buildPinnedCortex
  // Envelope/composeCortexForTicker all state an absent-source count in their headline). A real,
  // measured production shape: cortex-source-timeout-outcome-ab.mjs found 19% of graded 0DTE
  // commits carried a real CortexSourceTimeout via the same shared fetchVectorFullState fan-out
  // swing's gex-walls/wall-trend/darkpool-confluence sources use — so a veto/oppose-bearing swing
  // Cortex read with simultaneous absent sources is a realistic production shape, not theoretical.
  const absentCount = v.absent?.length ?? 0;
  const absentSuffix = absentCount > 0 ? ` · ${absentCount} source${absentCount === 1 ? "" : "s"} absent` : "";
  const header = `Cortex ${view.decision ?? "read"} at commit — net score ${v.score >= 0 ? "+" : ""}${v.score}, conviction ${v.conviction}, ${vetoCount} veto${vetoCount === 1 ? "" : "es"} · ${opposeCount} opposing item${opposeCount === 1 ? "" : "s"}${absentSuffix}.`;
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

/**
 * Vector chart technicals — EMA stack, VWAP, RSI, MACD, structure.
 *
 * BUG FIX (Ask Largo standing mandate, 2026-09-12): unlike `vectorDeskSection`/`dataFreshnessSection`/
 * `watchForSection` — all fixed the same day for the identical defect class — this section was NOT
 * bucket-gated at all: for a CLOSED play it rendered today's live spot/EMA/VWAP/RSI/MACD/structure
 * with no framing whatsoever, reading as if it described the trade's OWN conditions rather than the
 * market's state now, days or weeks after the position resolved (live repro: AAPL:36, closed
 * 2026-09-04, brief compose 2026-09-12 — "Chart technicals" printed today's spot/EMA stack/VWAP with
 * zero indication the trade itself closed 8 days earlier under different conditions). Same identity/
 * freshness contract violation (Largo C1/C2) `vectorDeskSection` already documents for this exact
 * bucket; the fix is the same shape — an explicit "current, not as-traded" disclosure line — applied
 * here for the first time.
 */
export function chartTechnicalsSection(
  vec: VectorFullState | null,
  sessionDate?: string | null,
  bucket: "watch" | "open" | "closed" = "open",
  // BUG FIX (2026-09-15, Ask Largo standing mandate, live repro TSM WATCH brief): this section used
  // to read `vec.regime?.posture` directly with no GEX-matrix fallback, so whenever Vector's own
  // regime read landed on "unknown" it silently OMITTED the "Dealer gamma regime" line entirely —
  // even when a fresh, resolvable GEX-matrix posture existed and was already shown two sections down
  // in "Trade manager read" (via `resolveGammaPosture`, fixed for that section and two others earlier
  // the same day). Not a wrong-value bug (silence, not fabrication) but a real completeness gap: a
  // trader reading only Chart technicals saw nothing where a determinable answer existed elsewhere in
  // the same brief. `ctx` is optional (defaults to the old vec-only behavior) so existing callers that
  // don't have a full context on hand are unaffected; the real production call site now passes it.
  ctx?: SwingPlayBriefContext | null,
): RichSection | null {
  if (!vec?.technicals && vec?.spot == null) return null;
  // Ask Largo standing mandate, readMs-anchor sweep follow-up to #5351: `ctx` is already threaded
  // into this call (composeSwingPlayBrief passes it at the real call site) specifically so every
  // staleness check in the brief agrees on ONE "now" — prefer it over a fresh wall-clock sample.
  const readMs = ctx?.readMs ?? Date.now();
  const vectorStale = vectorSnapshotStale(vec, readMs, sessionDate);
  const t = vec.technicals;
  // Prepended only once real content exists below (never on an otherwise-empty section) — a
  // disclosure with nothing to disclose about would itself be a fabricated-looking line.
  const closedDisclosure = "_Current chart read — not the technicals this trade closed under._";
  const lines: string[] = [];
  // FIX (Ask Largo standing mandate, 2026-10-13, live repro ASTS:53 CLOSED brief): this used to
  // render "Last snapshot ... chart read may lag spot" + "Vector desk grade: X (from prior
  // snapshot)" for OPEN/WATCH briefs — but `vectorDeskSection` (below) independently renders the
  // exact same "Last snapshot ... Vector desk read may lag spot" + "Vector desk grade: X (from
  // prior snapshot)" pair under its own title for the identical stale condition, so an OPEN/WATCH
  // brief showed the same fact twice under two section titles. Omitting entirely was the fix for
  // that specific duplicate phrasing.
  //
  // BUG FIX (2026-10-17, Ask Largo standing mandate, live repro SWING:GOOGL:58 CLOSED brief):
  // the omission above was unconditional, so it also fired for CLOSED briefs — but CLOSED is a
  // different case: `vectorDeskSection` got its own fix the same day (see its comment) to render
  // a distinct, non-stale-labeled line for CLOSED ("Current Vector read: grade X · conviction Y
  // (since this play closed)") instead of the "(from prior snapshot)" phrasing this comment was
  // originally about, so the specific duplicate text no longer exists for CLOSED. Meanwhile this
  // section's own CLOSED-bucket disclosure code a few lines below (`closedDisclosure` +
  // `closedMarketSessionNote`) was built but had been unreachable ever since this unconditional
  // return — live-confirmed: GOOGL:58 CLOSED rendered a full 13-section "Chart technicals" block
  // once, then vanished to 12 sections on three immediate re-fetches once Vector snapshot went
  // stale, with the disappearance undisclosed anywhere in `unavailableSources`/`confidence`
  // (Largo C3 violation — a real EMA/VWAP/RSI/structure read silently read as "no data" rather
  // than an honest "last known, from prior snapshot" close framing). Vector is "almost always
  // stale by the time the position closed" (vectorDeskSection's own fix comment), so CLOSED was
  // close to the *default* case this early return was eating, not a rare edge. Bucket-gating the
  // return (same shape as vectorDeskSection's reorder) restores the technicals for CLOSED while
  // leaving OPEN/WATCH's omission — the actual fix this comment above describes — untouched.
  if (vectorStale && bucket !== "closed") return null;
  // BUG FIX (Ask Largo standing mandate, 2026-10-20, live repro SWING:TSLA:57 CLOSED brief): once
  // Vector goes stale, this line still rendered the raw, stale `vec.spot` unconditionally, while
  // `gexPostureSection`/`chartLevelsSection` (same envelope, via `preferredGexWalls`) already fall
  // back to the GEX matrix's own spot in that exact case — the same "two different precedence
  // rules for one conceptual level" defect class the king-strike/wall fixes above this function
  // already cover, just never applied to spot itself. Live-confirmed: TSLA:57 CLOSED showed "Spot:
  // 368.95" here (stale Vector) and "spot 367.43" in GEX posture/Since-it-closed (GEX-matrix
  // fallback) in the same brief, neither flagging the other. `vectorStale` true at this point can
  // only happen for `bucket === "closed"` (the early return above already excludes every other
  // case), so this only changes the CLOSED, stale-Vector path; ctx is optional here (older callers
  // that don't pass it keep the old raw-vec.spot behavior, same as every other ctx-gated read in
  // this file).
  const displaySpot = vectorStale && ctx ? preferredGexWalls(ctx).spot : vec.spot;
  if (displaySpot != null) lines.push(`Spot: **${fmtPriceLevel(displaySpot)}**`);
  if (t?.emaStack) lines.push(`EMA 9/21/50 stack: **${t.emaStack}**`);
  if (t?.vwap != null) {
    // BUG FIX (Ask Largo standing mandate, 2026-10-20): this function's own entry guard above
    // (`if (!vec?.technicals && vec?.spot == null) return null;`) deliberately continues when
    // `technicals` exists even though `vec.spot` is null — otherwise it would just be `if
    // (!vec?.technicals) return null;`. `displaySpot` can likewise be null here (the CLOSED,
    // stale-Vector GEX-fallback path above can itself resolve to no spot). The old `&&`
    // short-circuit folded "spot unknown" into the FALSE branch of the ternary, silently rendering
    // "price below session VWAP" whenever displaySpot was null — not just when spot was genuinely
    // below VWAP. This is inconsistent with the file's own established convention a few functions
    // away (`chartLevelsSection`'s wall/flip lines only append a spot-relative clause when spot is
    // known, never asserting a side otherwise) and the Largo C3 absence principle this file cites
    // repeatedly: omit when undeterminable, never fabricate. Omit the side clause entirely rather
    // than defaulting it.
    const side = displaySpot != null ? (displaySpot >= t.vwap ? "above" : "below") : null;
    lines.push(
      side != null
        ? `VWAP **${fmtPriceLevel(t.vwap)}** — price ${side} session VWAP`
        : `VWAP **${fmtPriceLevel(t.vwap)}**`,
    );
  }
  if (t?.rsi != null) lines.push(`RSI: **${t.rsi.toFixed(0)}**`);
  if (t?.macd) lines.push(`MACD: **${t.macd}**`);
  if (t?.goldenPocket) {
    lines.push(`Golden pocket: **${fmtPriceLevel(t.goldenPocket.low)}–${fmtPriceLevel(t.goldenPocket.high)}**`);
  }
  if (t?.structure) {
    lines.push(
      `Structure: **${t.structure.type}** ${t.structure.direction} @ **${fmtPriceLevel(t.structure.level)}**`,
    );
  }
  // "Vector regime" is a DEALER GAMMA posture (long-gamma/short-gamma), not a directional call —
  // labeling it bare "long"/"short" next to directional signals (EMA stack, MACD, structure
  // direction) in this same section risks reading as a trade direction that can contradict the
  // very next "Vector desk" section's own directional POSITION call for the same ticker.
  const posture = ctx ? resolveGammaPosture(ctx, vec, readMs) : (vec.regime?.posture ?? null);
  if (posture && posture !== "unknown" && posture !== "transition") {
    lines.push(`Dealer gamma regime: **${posture} gamma**`);
  } else if (posture === "transition") {
    lines.push(`Dealer gamma regime: **transition** (near flip)`);
  }
  // BUG FIX (Ask Largo standing mandate, 2026-10-21, live repro NVDA:62/CRWV:61 CLOSED briefs):
  // the 2026-10-17 fix above (bucket-gating the stale early return) restored this section for
  // CLOSED briefs, but this grade push was never re-gated alongside it — so on every CLOSED brief
  // the identical "Vector desk grade: X" fact now renders here AND in vectorDeskSection's own
  // `bucket === "closed"` branch ("Current Vector read: grade X · conviction Y (since this play
  // closed)"), the exact duplicate the 2026-10-13 fix (see comment above) eliminated for
  // OPEN/WATCH but which the 2026-10-17 bucket-gating silently reopened for CLOSED specifically.
  // vectorDeskSection owns this fact for CLOSED (its own comment: "Closed briefs keep only the
  // informational grade/conviction snapshot") — suppress it here for that bucket, same as the
  // stale-return above.
  if (vec.play?.grade && bucket !== "closed") lines.push(`Vector desk grade: **${vec.play.grade}**`);
  if (!lines.length) return null;
  if (bucket === "closed") {
    lines.unshift(closedDisclosure);
    const sessionNote = closedMarketSessionNote(vec, ctx?.ecosystem?.gex_positioning, readMs);
    if (sessionNote) lines.splice(1, 0, sessionNote);
  }
  // Bias is derived from the closed trade's OWN direction elsewhere (the "Trade manager read"
  // Lessons section already covers post-mortem framing); a closed brief's chart-technicals bias
  // is forced neutral so this current-market read is never badged bullish/bearish as if it were
  // live guidance on a position that has already resolved (same Largo C5 discipline
  // `vectorDeskSection`'s closed-bucket branch above already applies).
  const bias = bucket === "closed" ? "neutral" : t ? technicalsBias(t, vec.spot ?? null) : "neutral";
  return {
    title: "Chart technicals",
    body: lines.join("\n"),
    bias,
  };
}

// BUG FIX (2026-09-14, Ask Largo standing mandate, live repro NAIL/IONX): this used to join
// `z.kinds` bare, sharing the exact "call-wall"/"put-wall" name with the single top-ranked wall
// shown a few lines above in "Levels on chart" even when the confluence engine picked a
// LOWER-ranked wall at a materially different price — live repro NAIL showed "35.00
// (call-wall+max-pain, score 5.0)" here while "Call wall (GEX): 40.00" sat three lines up in the
// SAME section, reading as a contradiction. `play-brief.ts`'s structured `levels` array already
// disambiguates this (fixed 2026-09-13); this prose call site never picked up the same fix — see
// `confluenceZoneKindsLabel`'s own doc comment (play-brief-absence.ts) for the full history.
function formatConfluenceZone(
  z: ConfluenceZone,
  spot: number | null,
  primary: { callWall?: number | null; putWall?: number | null },
): string {
  const kinds = confluenceZoneKindsLabel(z, primary);
  const dist = spot != null ? ` · ${fmtDist(spot, z.center)}` : "";
  return `• **${fmtPriceLevel(z.center)}** (${kinds}, score ${z.score.toFixed(1)})${dist}`;
}

/**
 * Preferred call/put wall + spot for a brief: live Vector ladder wall first, GEX matrix wall as
 * fallback — the SAME precedence `chartLevelsSection`'s "Levels on chart" line already applies.
 *
 * Extracted 2026-09-11 (Ask Largo monitor cycle, live MSTR:33) because `gexPostureSection`'s
 * "Nearest wall" line independently recomputed nearest-wall from the raw GEX-matrix-only
 * call_wall/put_wall (via `ecosystem.gex_positioning.nearest_wall`), bypassing this precedence
 * entirely — the exact "two different precedence rules for the same conceptual level" defect
 * class already fixed for GEX king strike on 2026-09-09 (see that fix's comment right below,
 * still in this file). Live evidence: MSTR:33 rendered "Put wall (GEX): 125.00" in "Levels on
 * chart" (Vector ladder) but "Nearest wall: 120.00 (support, -7.3 pts...)" in "GEX posture" (raw
 * GEX-matrix put_wall) in the SAME envelope for the SAME spot (127.25) — 125 is numerically
 * closer to spot than 120, so the second number wasn't just a different source, it was also the
 * less-true "nearest" wall by the matrix's own raw levels. A shared resolver keeps future callers
 * from re-deriving "nearest" a third way (the risk `nearestWallFromLevels`'s own header warns
 * about for its two existing call sites).
 */
export function preferredGexWalls(ctx: SwingPlayBriefContext): {
  spot: number | null;
  callWall: number | null;
  putWall: number | null;
  callWallFromStaleGex: boolean;
  putWallFromStaleGex: boolean;
  flip: number | null;
  flipFromStaleGex: boolean;
} {
  const vec = vectorOf(ctx);
  const gex = ctx.ecosystem?.gex_positioning;
  // Ask Largo standing mandate, readMs-anchor sweep follow-up to #5351: ctx is a required param
  // here — prefer its stamped readMs over a fresh wall-clock sample.
  const readMs = ctx.readMs ?? Date.now();
  const vectorStaleForLevels = vectorSnapshotStale(vec, readMs, ctx.sessionDate);
  const gexStaleForLevels = gexMatrixStale(gex, readMs);
  const spot =
    (vectorStaleForLevels ? undefined : vec?.spot) ??
    (gexStaleForLevels ? undefined : gex?.spot) ??
    null;
  const vecCallWall = vectorStaleForLevels ? undefined : vec?.gexWalls?.callWalls?.[0]?.strike;
  const vecPutWall = vectorStaleForLevels ? undefined : vec?.gexWalls?.putWalls?.[0]?.strike;
  const callWall = vecCallWall ?? gex?.call_wall ?? null;
  const putWall = vecPutWall ?? gex?.put_wall ?? null;
  const callWallFromStaleGex = vecCallWall == null && gex?.call_wall != null && gexStaleForLevels;
  const putWallFromStaleGex = vecPutWall == null && gex?.put_wall != null && gexStaleForLevels;
  // Ask Largo standing mandate, 2026-10-20 (fresh-angle technicals audit): the same Vector-first/
  // GEX-matrix-fallback precedence chartLevelsSection already establishes inline for its own
  // "Gamma flip" line — centralized here for the same reason the walls above already are (this
  // function's own header): so every "nearest level" consumer (gexPostureSection, the Dealer
  // posture evidence line in play-brief.ts) reads the identical flip value chartLevelsSection
  // shows, instead of each re-deriving "the flip" a different way and risking disagreement.
  const vecFlip = vectorStaleForLevels ? undefined : vec?.gammaFlip;
  const flip = vecFlip ?? gex?.flip ?? null;
  const flipFromStaleGex = vecFlip == null && gex?.flip != null && gexStaleForLevels;
  return { spot, callWall, putWall, callWallFromStaleGex, putWallFromStaleGex, flip, flipFromStaleGex };
}

/**
 * Extends a wall-only "nearest level" answer (`nearestWallFromLevels`) with the gamma flip as a
 * third, equally-eligible candidate.
 *
 * BUG FOUND (Ask Largo standing mandate, 2026-10-20, fresh-angle technicals audit, adversarially
 * verified): `nearestWallFromLevels` (gex-nearest-wall.ts) only ever compares the call/put wall —
 * it has no flip parameter at all — so gexPostureSection's "Nearest wall" line and play-brief.ts's
 * "Dealer posture" evidence line could both name a wall as "nearest" while the gamma flip sat
 * genuinely closer to spot in the SAME brief. chartLevelsSection's own "Nearest wall" line (via
 * vec.proximity/deriveWallProximity) already considers the flip, so this is the third of three
 * sections with inconsistent precedence on the identical conceptual question — same bug shape this
 * file has already fixed twice before (GEX king strike 2026-09-09, GEX walls+spot 2026-09-11).
 * Deliberately NOT fixed inside the shared `nearestWallFromLevels` itself: that helper also backs
 * `gex-positioning.ts`'s general-purpose `nearest_wall` field, read by other desks (e.g. Thermal)
 * that have no flip concept wired into this call shape — widening it there risks an unreviewed
 * behavior change outside swing. This wraps the wall-only answer at the swing call sites instead.
 */
export type NearestLevel = {
  strike: number;
  kind: "resistance" | "support" | "flip";
  distance_pts: number;
} | null;

export function nearestLevelWithFlip(
  wall: NearestWall,
  flip: number | null | undefined,
  flipFromStaleGex: boolean,
  spot: number,
): NearestLevel {
  const candidates: Array<{ strike: number; kind: "resistance" | "support" | "flip"; distance_pts: number }> = [];
  if (wall) candidates.push(wall);
  if (flip != null && Number.isFinite(flip) && !flipFromStaleGex) {
    candidates.push({ strike: flip, kind: "flip", distance_pts: Number((flip - spot).toFixed(2)) });
  }
  let nearest: NearestLevel = null;
  for (const c of candidates) {
    if (nearest == null || Math.abs(c.distance_pts) < Math.abs(nearest.distance_pts)) nearest = c;
  }
  return nearest;
}

/**
 * GEX walls, flip, max pain, expected move, confluence nodes.
 *
 * Bucket-gated (Ask Largo standing mandate, 2026-09-12) same as `chartTechnicalsSection`/
 * `gexPostureSection`/`wallDynamicsSection` this same pass: a CLOSED play's levels here are
 * TODAY's live GEX/Vector read, unconnected to the position under review — the already-shipped
 * "Since it closed" section (`watchForSection`) covers spot-vs-gamma-flip with explicit framing,
 * but this section duplicated the same underlying numbers (call/put wall, gamma flip) with none.
 */
export function chartLevelsSection(ctx: SwingPlayBriefContext): RichSection | null {
  const vec = vectorOf(ctx);
  const eco = ctx.ecosystem;
  const gex = eco?.gex_positioning;
  // Ask Largo standing mandate, readMs-anchor sweep follow-up to #5351: ctx is a required param
  // here — prefer its stamped readMs over a fresh wall-clock sample.
  const readMs = ctx.readMs ?? Date.now();
  const vectorStaleForLevels = vectorSnapshotStale(vec, readMs, ctx.sessionDate);
  const gexStaleForLevels = gexMatrixStale(gex, readMs);
  const { spot, callWall, putWall, callWallFromStaleGex, putWallFromStaleGex } = preferredGexWalls(ctx);
  const lines: string[] = [];

  const vecFlip = vectorStaleForLevels ? undefined : vec?.gammaFlip;
  const flip = vecFlip ?? gex?.flip ?? null;
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
    lines.push(`**Call wall (GEX):** ${fmtPriceLevel(callWall)}${spot != null ? ` — ${fmtDist(spot, callWall)}` : ""}`);
  }
  if (putWall != null && !putWallFromStaleGex) {
    lines.push(`**Put wall (GEX):** ${fmtPriceLevel(putWall)}${spot != null ? ` — ${fmtDist(spot, putWall)}` : ""}`);
  }
  if (flip != null && !flipFromStaleGex) {
    lines.push(`**Gamma flip:** ${fmtPriceLevel(flip)}${spot != null ? ` — ${fmtDist(spot, flip)}` : ""}`);
  }
  if (king != null && !kingFromStaleGex) {
    lines.push(`GEX king strike: **${fmtPriceLevel(king)}**`);
  }
  if (vec?.maxPain != null && !vectorStaleForLevels) {
    lines.push(`Max pain: **${fmtPriceLevel(vec.maxPain)}**`);
  }
  if (vec?.expectedMove?.bands?.length && !vectorStaleForLevels) {
    const bandStr = vec.expectedMove.bands
      .slice(0, 2)
      .map((b) => `${b.sigma}σ ${fmtPriceLevel(b.low)}–${fmtPriceLevel(b.high)}`)
      .join(" · ");
    lines.push(`Expected move: **${bandStr}**`);
  }
  // BUG FIX (Ask Largo standing mandate, 2026-10-20, fresh-angle technicals audit): when
  // `deriveWallProximity` resolves to the gamma flip (side === "flip"), its callout restates the
  // EXACT value the "Gamma flip:" line just above already rendered — a same-section self-duplicate
  // (live repro: spot 7550, flip 7560 at 0.13% away vs. both walls farther out — "Gamma flip:
  // 7560.00 — +0.1% ($10.00 from spot)" immediately followed by "Nearest wall: 7560.00 gamma flip
  // overhead (0.13% away) — a cross flips the regime..."). Only suppress the flip case — a
  // genuine call/put wall callout here is independent information from the bare "Call/Put wall
  // (GEX)" line above (different source: Vector's own proximity/band logic, not just the raw
  // strike) and must keep rendering unchanged.
  const proximityDuplicatesFlipLine =
    vec?.proximity?.side === "flip" && flip != null && !flipFromStaleGex;
  if (vec?.proximity?.strike != null && !vectorStaleForLevels && !proximityDuplicatesFlipLine) {
    // BUG FIX (2026-09-12): this used to PREPEND "{strike} ({side}, {pct}% away) —" ahead of
    // `vec.proximity.callout` — but `deriveWallProximity` (vector-wall-proximity.ts) already builds
    // callout as a complete sentence that independently states the same strike/side/"wall" itself
    // (e.g. "Testing 332.50 put wall (0.02% below) — dealers buy weakness; support unless it
    // breaks on volume."). The prefix duplicated that verbatim — live repro: AAPL closed-position
    // swing brief 2026-09-12, "Nearest wall: 332.50 (put, -0.0% away) — Testing 332.5 put wall
    // (0.02% below) — ...". The exact same duplication, from the exact same `WallProximity` shape,
    // was independently found and fixed the same day at a different call site
    // (vector-play-engine.ts's `starred` array) — this is a second, previously-unchecked instance
    // of it. Push the callout alone; nothing is lost, see that fix's comment for why.
    lines.push(`Nearest wall: ${vec.proximity.callout}`);
  }
  const zones = vec?.confluenceZones ?? [];
  if (zones.length && !vectorStaleForLevels) {
    const top = [...zones].sort((a, b) => b.score - a.score).slice(0, 4);
    lines.push(
      "**Confluence nodes:**\n" + top.map((z) => formatConfluenceZone(z, spot, { callWall, putWall })).join("\n"),
    );
  }
  const dp = vec?.darkPoolLevels ?? [];
  // BUG FIX (2026-10-06): see collectFocalLevels (play-brief-narrative.ts) for the full account —
  // `vectorStaleForLevels` alone cannot catch a dark-pool cache entry up to 20+ min stale while the
  // rest of the Vector state computed live seconds ago.
  if (dp.length && !vectorStaleForLevels && !darkPoolStale(vec)) {
    lines.push(
      "**Dark pool levels:** " +
        dp
          .slice(0, 3)
          .map((l) => `${fmtPriceLevel(l.strike)} (${l.premium != null ? fmtPremium(l.premium) : "—"})`)
          .join(" · "),
    );
  }
  // FIX (Ask Largo standing mandate, 2026-09-18): the gamma magnet is narrated in prose via
  // magnetCoaching (play-brief-narrative-coaching.ts, called from
  // tradeManagerNarrativeSection/collectCoachingBullets) for OPEN/WATCH plays — but
  // collectCoachingBullets EARLY-RETURNS `closedCoaching(play)` alone for `bucket === "closed"`
  // and never reaches magnetCoaching. So a CLOSED play's magnet level exists in the structured
  // `levels`/"Key levels" array (play-brief.ts) but was narrated in NO prose section anywhere —
  // confirmed live on two independent CLOSED plays (NRG #34, CG #25, 2026-09-18 audit cycles).
  // Every OTHER Vector-derived level here (max pain, confluence nodes, dark pool) already narrates
  // regardless of bucket, so the magnet's absence was the gap, not an intentional superset-feed
  // design. Scoped to CLOSED only — OPEN/WATCH already get the magnet, with actionable framing,
  // from magnetCoaching; adding it here unconditionally would duplicate that line, the exact class
  // of bug this file's own "Nearest wall" dedup comment (above) warns against.
  if (vec?.magnet?.strike != null && !vectorStaleForLevels && statusBucket(ctx.play) === "closed") {
    lines.push(
      `**Gamma magnet:** ${fmtPriceLevel(vec.magnet.strike)}${spot != null ? ` — ${fmtDist(spot, vec.magnet.strike)}` : ""}`,
    );
  }
  if (!lines.length) return null;
  if (statusBucket(ctx.play) === "closed") {
    lines.unshift("_Current levels — not what this trade traded under._");
    const sessionNote = closedMarketSessionNote(vec, gex, readMs);
    if (sessionNote) lines.splice(1, 0, sessionNote);
  }
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
    // The market-regime-detector cron writes flow_anomalies every 30min but only dedups
    // (anomaly_type, ticker) writes within a 15-minute window at write time (see
    // EcosystemAnomaly's own doc comment) — so a pattern that persists across two 30-min
    // cron cycles (>15min apart) writes a SECOND row with byte-identical anomaly_type/detail
    // and only a newer detected_at. Undeduped, that renders the exact same bullet twice in
    // one brief (reproduced live on NRG 2026-09-11). Dedup on (anomaly_type, detail) here —
    // recent_anomalies is already ORDER BY detected_at DESC, so the first occurrence kept is
    // the most recent one.
    const seen = new Set<string>();
    const deduped = eco.recent_anomalies.filter((a) => {
      const key = `${a.anomaly_type} ${a.detail}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const anomalies = deduped
      .slice(0, 4)
      .map((a) => {
        // recent_anomalies is a last-24h feed while the HELIX tape line above it is a 6h read
        // (see relativeAgeLabel's own doc comment) — label each anomaly's own age so it reads
        // as a separate-in-time signal rather than a same-window contradiction of the tape.
        const ageLabel = relativeAgeLabel(a.detected_at);
        const dirPart = a.direction ? ` (${a.direction})` : "";
        const agePart = ageLabel ? ` [${ageLabel}]` : "";
        return `• **${a.anomaly_type}** — ${a.detail}${dirPart}${agePart}`;
      })
      .join("\n");
    lines.push("**Flow anomalies:**\n" + anomalies);
  }

  // FIX (Ask Largo standing mandate, 2026-09-18): `eco.flow_full_state.recent` comes from
  // fetchFlowFullState() -> getFlowTapeSummary({ ticker, limit }) with NO `since_hours`/`order`
  // passed — so per getFlowTape's own default (`order: opts?.since_hours != null && <=6 ?
  // "recent" : undefined`) this sorts BIGGEST-PREMIUM-FIRST over `fetchRecentFlows`'s 48h default
  // window (db.ts `sinceHours = params.since_hours ?? 48`), NOT most-recent-first over the same
  // 6h window as the `HELIX tape (Xh)` aggregate line directly above it (`trustedHelixFlow`'s
  // `FLOW_SUMMARY_WINDOW_HOURS = 6`). Rendering that list under the header "Recent prints" is a
  // real contract violation (precision/freshness): reproduced live on AAPL #37 2026-09-18 — the
  // aggregate read "calls $263K · puts $1.3M · 4 prints" (6h) while "Recent prints" directly below
  // it listed 5 individual CALL prints from $1.08M to $3.43M each, none visibly reconcilable with
  // the 4-print/$263K call aggregate one line up — a member reading both lines together sees an
  // internal contradiction, not a coherent tape read. tool-defs.ts's own get_flow_tape docstring
  // is explicit that this field is "last 48h window, sorted biggest-premium-first by default" —
  // the LLM-facing Largo tool documents the nuance so the MODEL can reason about it correctly, but
  // this deterministic (no-Anthropic, per route.ts's own comment) swing play-brief renders the
  // same rows to a MEMBER with a header claiming the opposite. Fix scoped to presentation only
  // (this file), not to fetchFlowFullState's query (that would also move `count`/`total_premium`/
  // `top_tickers`, which ARE documented as an intentional 48h/premium-sorted aggregate and are
  // consumed elsewhere) — relabel honestly and give each print its own age, exactly like the
  // `Flow anomalies` block two lines up already does via the SAME `relativeAgeLabel` helper, so a
  // reader can see for themselves that a listed print is outside the 6h aggregate window rather
  // than being told it's "recent" when it may be up to 48h old.
  const recent = helixFresh ? (eco.flow_full_state?.recent ?? []) : [];
  if (recent.length) {
    const prints = recent
      .slice(0, 5)
      .map((p) => {
        // BUG FIX (Ask Largo standing mandate, 2026-10-20): this line used `fmtUsd` (fmtOptionUsd,
        // documented for per-contract PRICES in the $0.01-$999.99 range) on raw HELIX flow-print
        // premiums (hundreds of thousands of dollars), producing unreadable "$715000.00" one line
        // below this same section's HELIX tape aggregate, which correctly renders "$204K" via the
        // K/M-scaled `fmtPremium` — two incompatible dollar-magnitude styles for the same kind of
        // fact in one section. `fmtPremium` is already imported/used elsewhere in this file for the
        // identical "flow premium" quantity (line ~1181, ~1132).
        const prem = p.premium != null ? fmtPremium(p.premium) : "—";
        const gex = p.gex_proximity ? ` @ ${p.gex_proximity.replace(/_/g, " ")}` : "";
        const ageLabel = relativeAgeLabel(p.alerted_at || p.event_at || null);
        const agePart = ageLabel ? ` [${ageLabel}]` : "";
        // FIX (Ask Largo standing mandate, C9 precision, 2026-09-20): this was the one strike
        // in the whole file rendered raw (`p.strike ?? "—"`) instead of `.toFixed(2)` — every
        // sibling strike render here (GEX king strike, dark-pool levels, nearest wall, gamma
        // magnet, confluence zones) rounds to 2dp at this presentation boundary. `p.strike` is a
        // Postgres NUMERIC column round-tripped through `Number(row.strike)` (db.ts), which can
        // legitimately carry more than 2 decimal digits for a fractional-strike contract, so an
        // unformatted print renders inconsistently against every other level in the same brief
        // (e.g. "232.5" here vs "232.50" two lines up) — a precision-contract violation (C9:
        // "rounding happens exactly once, at the presentation boundary", not inconsistently).
        const strikeLabel = typeof p.strike === "number" && Number.isFinite(p.strike) ? fmtPriceLevel(p.strike) : "—";
        return `• ${p.option_type ?? "—"} ${strikeLabel} ${prem}${gex}${agePart}`;
      })
      .join("\n");
    lines.push("**Notable prints (48h, largest premium first):**\n" + prints);
  }

  const z = zerodteLiveForSession(eco.zerodte_today, sessionDate);
  if (z) {
    // FIX (Ask Largo standing mandate, 2026-10-14, live ASTS repro): `${z.conviction ?? "—"}
    // conviction` printed a raw em-dash placeholder inline ("— conviction") whenever conviction was
    // null, instead of omitting the clause entirely — the flat-placeholder shape C3's absence
    // principle and the narrative-quality bar both discourage. Omit the whole clause when unknown.
    const convictionBit = z.conviction != null ? ` · ${z.conviction} conviction` : "";
    // BUG FIX (2026-10-21, Ask Largo standing mandate): this line was the one sibling in this
    // section with zero freshness/status disclosure — the HELIX tape line states its own window
    // and both Flow anomalies/Notable prints attach a per-item `relativeAgeLabel` bracket (see
    // those blocks' own comments a few lines up), but this one never surfaced `z.first_flagged_at`
    // (a real provenance timestamp) or `z.status` (a real lifecycle column — the SAME OPEN/HOLD/
    // TRIM/CLOSED idiom `zerodte_setup_log`/`swing_positions` both use), even though both are
    // fetched in the same query (ecosystem-context.ts). `zerodteLiveForSession`'s own gate is
    // whole-session-date granularity only — a setup flagged minutes ago and one that already
    // stopped out hours earlier in the SAME session both rendered identically, with no way for a
    // reader to tell them apart.
    const ageLabel = relativeAgeLabel(z.first_flagged_at);
    const agePart = ageLabel ? ` [${ageLabel}]` : "";
    const statusBit = z.status === "CLOSED" ? " _(already closed)_" : "";
    if (z.is_condor === true) {
      // A committed CONDOR's `direction` column is NOMINAL provenance only (the fade side of
      // the pin it came from) — the structure is delta-neutral, so comparing it against swing's
      // directional call and labeling it "aligned"/"conflict" would fabricate a directional
      // signal the 0DTE desk never actually took (board.ts's own ZeroDteSetup.direction comment:
      // "the directional gates ... do NOT apply to it"). Report the desk's real posture instead.
      lines.push(
        `0DTE desk: **sold iron condor** (structure-neutral, not a directional call)${convictionBit}${agePart}${statusBit}`,
      );
    } else {
      const aligned =
        (play.direction === "LONG" && z.direction === "long") ||
        (play.direction === "SHORT" && z.direction === "short");
      lines.push(
        `0DTE desk: **${z.direction}**${convictionBit}${aligned ? " · **aligned**" : " · **conflict** with swing direction"}${agePart}${statusBit}`,
      );
    }
  }

  if (!lines.length) return null;
  // Same disclosure as chartTechnicalsSection/chartLevelsSection/gexPostureSection/
  // wallDynamicsSection: every line above is CURRENT (as-of-request-time) flow/anomaly/desk
  // content, never a stored snapshot of what the trade actually traded under — a closed play
  // reading this with no framing could easily mistake it for the trade's own conditions.
  if (statusBucket(play) === "closed") {
    lines.unshift("_Current flow — not what this trade traded under._");
  }
  return { title: "Flow & positioning", body: lines.join("\n\n") };
}

/** Earnings, news, short interest, peers. */
export function catalystsSection(
  eco: EcosystemContext | null,
  // Ask Largo standing mandate, readMs-anchor sweep follow-up to #5351/#5392: this section was
  // NOT among the 9 sites #5392 fixed — it still sampled the wall clock twice below instead of
  // reusing the brief's single readMs anchor. `ctx` is optional (defaults to a fresh Date.now())
  // so existing callers/tests that don't have a full context on hand are unaffected; the real
  // production call site (buildIntelSections) now passes it.
  ctx?: SwingPlayBriefContext | null,
): RichSection | null {
  const arsenal = eco?.arsenal;
  if (!arsenal) return null;
  const readMs = ctx?.readMs ?? Date.now();
  const lines: string[] = [];

  // ENHANCEMENT (Ask Largo standing mandate, AGGRESSIVE MODE, 2026-10-18, flagged on #4076
  // comment 6243951905): earningsDaysUntil is hoisted out of this block (was previously a local
  // `d` used only here) so the headlines block below can connect an imminent print to this
  // week's headlines with one synthesizing sentence, instead of two unrelated bullet blocks
  // separated by a blank line — see that block's own comment for the live repro.
  let earningsDaysUntil: number | null = null;
  if (arsenal.earnings?.earnings_date) {
    const d = arsenal.earnings.days_until;
    earningsDaysUntil = d ?? null;
    // BUG FIX (2026-10-21, Ask Largo standing mandate): d<=0 used to collapse unconditionally to
    // a bare "today" with no disclosure of whether the print has already LANDED or is still
    // ahead — the same BMO/AMC-anchoring ambiguity this repo's own CLAUDE.md documents for
    // Meridian reactions. `catalystCoaching` (play-brief-narrative-coaching.ts) already solves
    // this exact ambiguity for the SAME `arsenal.earnings` field (aggregated into this same
    // brief's "Trade manager read"), via a bell-relative threshold against the report-time bucket
    // (16:00 ET for afterhours, 09:30 ET for premarket). Reusing that exported helper here
    // (rather than reimplementing it) so this bullet and "Trade manager read" can't independently
    // drift on whether the identical print has landed — without this, a member could read
    // "Earnings already printed today" in one section and a bare, forward-looking "today
    // (afterhours)" in this one, for the same print.
    const printThresholdMs =
      d === 0 && arsenal.earnings.earnings_date != null
        ? printAlreadyLandedThresholdMs(arsenal.earnings.earnings_date, arsenal.earnings.report_time)
        : null;
    const nowMs = ctx?.asOf != null ? (parseEtStamp(ctx.asOf) ?? Date.parse(ctx.asOf)) : null;
    const alreadyPrinted =
      printThresholdMs != null && nowMs != null && Number.isFinite(nowMs) && nowMs >= printThresholdMs;
    const when = alreadyPrinted
      ? "**already printed**"
      : d != null && d <= 0
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

  if (arsenal.fundamentals && !fundamentalsAncient(arsenal.fundamentals.as_of, readMs)) {
    const f = arsenal.fundamentals;
    const parts: string[] = [];
    if (f.days_to_cover != null) parts.push(`short DTC **${f.days_to_cover.toFixed(1)}d**`);
    if (f.short_volume_ratio != null) parts.push(`short vol ratio **${(f.short_volume_ratio * 100).toFixed(0)}%**`);
    if (parts.length) {
      // Mirrors the headlines block's staleLead just below (#4076 comment 5747893411's secondary
      // point): short-interest is cadence-scaled to ~biweekly FINRA settlement, not the generic
      // market-tick bucket, so only genuinely LAGGING reads (beyond FUNDAMENTALS_RECENT_CEILING_MS,
      // still under the ancient omission ceiling above) get a disclosure — a normal few-days-old
      // read renders with none, same as before.
      const fundamentalsStale = fundamentalsFreshnessTag(f.as_of, readMs) === "stale";
      const fundamentalsAgeLabel = fundamentalsStale ? ageDaysLabel(fundamentalsAgeMs(f.as_of, readMs)) : null;
      const fundamentalsStaleLead = fundamentalsStale
        ? `**Last settlement**${fundamentalsAgeLabel != null ? ` (~${fundamentalsAgeLabel} old)` : ""} — short-interest may lag the current cycle.\n\n`
        : "";
      lines.push(fundamentalsStaleLead + parts.join(" · "));
    }
  }

  if (arsenal.news?.headlines?.length) {
    // Largo C2 (2026-09-18, Ask Largo standing mandate): `arsenal.news.as_of` is the real fetch-
    // time `NewsResult.asOf` (see that field's own doc comment on ecosystem-context.ts for the
    // full history — it existed upstream and was silently dropped one layer up before this fix).
    // A degraded Benzinga upstream can keep serving the SAME stored headline list, unbumped, for
    // up to 10 minutes under `serverCache`'s stale-while-revalidate path — the identical exposure
    // `meridianCatalystSection` two functions down already discloses for its own catalyst read;
    // this section was the one sibling that read a freshness-bearing field with zero disclosure.
    const stale = newsCatalystStale(arsenal.news.as_of, readMs);
    const ageLabel = stale ? ageSecondsLabel(newsCatalystAgeMs(arsenal.news.as_of, readMs)) : null;
    const staleLead = stale
      ? `**Last snapshot**${ageLabel != null ? ` (~${ageLabel} old)` : ""} — headlines may lag.\n\n`
      : "";
    // GAP FOUND (2026-09-28, Ask Largo standing mandate): arsenal.news.headlines can carry the
    // SAME headline text twice (live repro U/WATCH, 2026-09-28: "10 Information Technology Stocks
    // Whale Activity In Today's Session" appeared as both item 1 and item 3) — upstream Benzinga
    // re-publishes near-identical wire items with identical titles, and this section rendered the
    // raw array with no dedup, burning one of only 4 shown slots on a repeat with zero new
    // information. Dedup BEFORE slicing to 4 (not after) so a duplicate never displaces a real,
    // distinct headline that would otherwise have made the cut. Case/whitespace-insensitive,
    // first-occurrence order preserved. Scoped to this render only — the two other readers of
    // arsenal.news.headlines (ecosystem-narrative.ts, ticker-verdict.ts) only ever take headlines[0]
    // and are unaffected either way.
    const seenHeadlines = new Set<string>();
    const dedupedHeadlines = arsenal.news.headlines.filter((h) => {
      const key = h.trim().toLowerCase();
      if (seenHeadlines.has(key)) return false;
      seenHeadlines.add(key);
      return true;
    });
    // ENHANCEMENT (Ask Largo standing mandate, AGGRESSIVE MODE, 2026-10-18, #4076 comment
    // 6243951905): when earnings falls inside the same ~2-week window meridianCatalystSection's
    // own "14-day Meridian window" messaging uses below, the headlines are plausibly
    // the very catalyst driving the move into that print — live repro: TSLA, earnings in 4 days
    // afterhours, sitting directly above four Roadster-reveal headlines, rendered as two
    // isolated blocks with zero connective tissue. Add one synthesizing sentence ahead of the
    // bullets rather than leaving the reader to infer the connection themselves. The "Earnings:
    // ..." line above still renders exactly as before — this only adds a lead-in, never removes
    // or restates the date — and when earnings is null/far-out, earningsDaysUntil is null/out of
    // range and this is a no-op (bridgeLead stays "").
    const earningsSoon =
      earningsDaysUntil != null && earningsDaysUntil >= 0 && earningsDaysUntil <= 14;
    const bridgeLead = earningsSoon
      ? "_That earnings date keeps IV/positioning sensitive — the headlines below look like the likely driver into it._\n\n"
      : "";
    lines.push(
      bridgeLead +
        staleLead +
        "**Headlines:**\n" +
        dedupedHeadlines
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

/**
 * Why the entry trigger level can no longer actually fire the setup — null when it still can.
 *
 * BUG FIX (Ask Largo standing mandate, 2026-09-12): `watchForSection`'s "Entry trigger" bullet
 * asserted, unconditionally, that crossing `entryTriggerUnderlyingPx` "is what actually fires the
 * setup" — true only while the setup is still alive. Live repro, two shapes:
 *   - SKHY WATCH brief: `setupState === "INVALIDATED"` (thesis already broke — gate `thesis_invalidated`)
 *     with spot **190.38 already above** the 177.00 long trigger. The claimed mechanic ("break above
 *     this fires the setup") had already been satisfied by price and had NOT fired — directly
 *     contradicting the sentence next to the number.
 *   - MRVL WATCH brief: `watchEntryExpired === true` (entry-validity deadline passed,
 *     entry-enterability.ts's `pastEntryDeadline`) — the headline correctly says "EXPIRED — wait for
 *     a fresh setup," but four sections later "Watch levels" still framed the same trigger as live
 *     and actionable with no cross-reference to that framing.
 * Both are the same root cause: the line rendered from `entryTriggerUnderlyingPx` alone, never
 * checking the setup's own already-computed dead/invalidated state (`play.setupState`,
 * `play.watchEntryExpired` — both already carried on `TerminalPlay` for exactly this kind of check
 * elsewhere in this file). The number itself stays (still useful as "the level that would have
 * mattered") — only the false causal claim is corrected.
 *
 * WIDENED (Ask Largo standing mandate, 2026-10-18): originally called the narrow `deadPlayReason`
 * (entry-enterability.ts) — the 4-case check — which was the same one reused by the "Gates
 * blocking entry" headers in play-brief.ts/play-brief-narrative-coaching.ts at the time this
 * function was written. The same day, those two sibling call sites were widened to the broader
 * `gateFramingMootReason` (adds FORMING and `aboveFloor===false`, plus a legacy_exempt-only
 * gateBlocks case) after a live repro showed a TRIGGERED/AT_TRIGGER/below-floor WATCH play's
 * "Entry trigger" bullet asserting an unqualified "this is what actually fires the setup" while
 * the SAME brief's Verdict section, two sections earlier, correctly said the real blocker was the
 * score floor — live repro TSM, 2026-10-18 (`score: 54.9` vs `scoreFloor: 60`, `setupState:
 * "TRIGGERED"`, `entryStatus: "AT_TRIGGER"`, no gate tag at all). This function was the third
 * caller of the shared narrow/wide pair and was missed by that same-day fix; swapped here to match
 * its two siblings — now all three callers share one source instead of two widened and one stale.
 *
 * BUG FIX (Ask Largo standing mandate, 2026-10-18, caught the same day as the widening above):
 * the widened `gateFramingMootReason` check was wired as an unconditional early return BEFORE the
 * older, more specific 2026-10-06 Legacy-pinned-price staleness check below it — and
 * `gateFramingMootReason`'s own legacy_exempt-only-`gateBlocks` case (entry-enterability.ts) is
 * EXACTLY the case every Legacy-promoted WATCH play unconditionally carries (Legacy promotion
 * never runs real commit gates, so `commitGateBlockedBy` resolves to `[legacy:exempt]` alone on
 * every one of these rows — see `resolveCommitGateBlockedBy`'s own comment). So the gate-moot
 * early-return permanently shadowed the staleness check for the one population it exists for,
 * silently dropping the pinned-price disclosure from every Legacy-promoted WATCH brief. Live
 * repro UNH, 2026-10-18: TRIGGERED/AT_TRIGGER/above-floor, `discoveryOrigin: ["NIGHT HAWK"]`,
 * `flagUnderlyingPx === entryTriggerUnderlyingPx === 399.15` (3 days stale),
 * `commitGateBlockedBy: ["legacy:exempt"]` — both facts are independently true and both matter
 * (the gate is moot AND the price is stale), so both checks are now evaluated and composed rather
 * than the first one short-circuiting the second.
 *
 * BUG FIX (Ask Largo standing mandate, 2026-10-19): the 2026-10-18 widening above over-applied the
 * "no longer fires the setup" claim to `gateFramingMootReason`'s two NON-dead cases (FORMING,
 * `aboveFloor===false`) — that function's own doc comment is explicit these two mean the play "is
 * very much still live, just not yet enterable," the opposite of "no longer fires." Live repro
 * EWY WATCH brief, 2026-10-19: Entry section correctly says the entry window is still open with
 * 2 days left, while this Watch-levels line (pre-fix) claimed the trigger "no longer fires the
 * setup" for the same still-FORMING play — a direct self-contradiction two sections apart in the
 * same brief. Fix: only the genuinely-dead reasons (`deadPlayReason`'s 4 cases) or a pinned-stale
 * price justify "no longer fires" — a framing-moot-but-alive reason (FORMING / below-floor) is
 * still composed and disclosed (so the TSM below-floor bug this file's widening fixed stays
 * fixed), just without the false permanence claim tacked onto it. The legacy-exempt-only gate-moot
 * case is unaffected: it is only ever reachable un-composed-with-deadness when NOT also
 * `legacyPinnedStale`, in which case the play is likewise still live, not dead, so the same
 * correction applies there too.
 */
export function entryTriggerDeadReason(play: TerminalPlay): string | null {
  // BUG FIX (Ask Largo standing mandate, 2026-10-06): a Legacy morning-confirm-promoted row's
  // `entryTriggerUnderlyingPx` is stamped ONCE at promotion (legacy-confirm-promote.ts's
  // `buildLegacySwingArtifacts` → `deriveSwingPlanLevels(direction, groundedSpotAtPromotion, atr)`,
  // which always sets `entryUnderlyingPx = price`) and that dossier/plan is never rebuilt again —
  // unlike organic discovery, which re-derives its dossier (and this field) on every scan cadence.
  // So a Legacy-promoted row's trigger is byte-identical to its flag anchor FOREVER, even days
  // later (confirmed live 2026-10-06: NKE/USO/NTAP all exact-equal, USO 4 days stale) — while an
  // organic row's trigger only coincidentally equals its flag anchor on the scan tick it was first
  // flagged, before any rebuild. Equality alone on an organic row is not evidence of staleness (it
  // would wrongly flag every freshly-flagged name), so this only fires for the Legacy-exempt
  // signature specifically, never from the numeric coincidence by itself.
  const legacyPinnedStale =
    isLegacyPromotedSignal(play.discoveryOrigin) &&
    play.flagUnderlyingPx != null &&
    play.entryTriggerUnderlyingPx != null &&
    play.flagUnderlyingPx === play.entryTriggerUnderlyingPx;
  const gateMootReason = gateFramingMootReason(play);
  // `gateFramingMootReason` returns `deadPlayReason(play)` verbatim when that's non-null (it checks
  // `deadPlayReason` first and returns it immediately) — so whenever BOTH are non-null they are the
  // SAME string, and this flag distinguishes "genuinely dead" from "framing-moot but still live"
  // without duplicating deadPlayReason's own branch logic.
  const isGenuinelyDead = deadPlayReason(play) != null;
  if (legacyPinnedStale && gateMootReason) {
    // Both facts are true at once for a Legacy-promoted WATCH play — compose them rather than let
    // either shadow the other (see the BUG FIX doc comment above, live repro UNH). The pinned-stale
    // price independently justifies "no longer fires" regardless of which gateMootReason fired.
    return `pinned at Legacy promotion, not refreshed since, and ${gateMootReason} — this level no longer fires the setup`;
  }
  if (gateMootReason && isGenuinelyDead) {
    return `${gateMootReason} — this level no longer fires the setup`;
  }
  if (legacyPinnedStale) {
    return "pinned at Legacy promotion, not refreshed since — this level no longer fires the setup";
  }
  // Framing-moot but NOT dead (FORMING / below-floor / legacy-exempt-only gate, none composed with
  // a pinned-stale price): the trigger level itself is still live and will fire the setup once
  // reached — disclose the reason entry isn't open yet, but never claim the level "no longer
  // fires," which is reserved for the genuinely-dead and pinned-stale cases above.
  if (gateMootReason) return gateMootReason;
  return null;
}

/** What to watch — invalidation, triggers, key levels. */
export function watchForSection(ctx: SwingPlayBriefContext, bucket: "watch" | "open" | "closed"): RichSection {
  const { play } = ctx;
  const vec = vectorOf(ctx);
  // Use the request-wide anchor (stamped once by composeSwingPlayBrief) rather than a fresh
  // Date.now() sampled at whatever instant THIS section happens to compose — see
  // SwingPlayBriefContext.readMs's own doc comment for the live repro (this section's own put-wall
  // fallback disagreeing with confluenceCoaching's, same vec, same request) this anchor fixes.
  const readMs = ctx.readMs ?? Date.now();
  const vectorStale = vectorSnapshotStale(vec, readMs, ctx.sessionDate);
  const gexForSpot = ctx.ecosystem?.gex_positioning;
  const gexStaleForSpot = gexMatrixStale(gexForSpot, readMs);
  const spot =
    (vectorStale ? undefined : vec?.spot) ??
    (gexStaleForSpot ? undefined : gexForSpot?.spot) ??
    null;
  // BUG FIX (2026-10-21, Ask Largo standing mandate): the premium stop/target rail cushion
  // percentages below are computed from play.mark/play.execMark — the identical quote
  // play-brief.ts's pnlSection (Position section, same envelope) already flags via this exact
  // staleCaveat string when optionMarkIsStale, applying it to Greeks/Spread. This section never
  // carried the equivalent disclosure, so a member could read "Option mark stale" in the Position
  // section and a confident, unqualified "53% cushion"/"79% cushion" two sections later in the
  // SAME brief, built off that identical stale quote. Mirrors play-brief.ts's own wording so the
  // two call sites read as one consistent disclosure, not two independently-phrased ones.
  const railStaleCaveat = optionMarkIsStale(play, readMs)
    ? " _(stale — same quote Mark flagged above)_"
    : "";
  const lines: string[] = [];

  if (bucket === "watch") {
    if (play.gateBlocks?.length) {
      // BUG FIX (2026-09-12): this used to re-render each gate's full `code: reason` text here —
      // but `watchEntrySection` (play-brief.ts, "Entry" section) already renders the IDENTICAL
      // `play.gateBlocks` list in full, under "Gates blocking entry:", and `composeSwingPlayBrief`
      // always places that "Entry" section BEFORE this one for a WATCH play. So a gated WATCH
      // brief carried the same gate codes+reasons TWICE — once under "Entry", once again here
      // under "Before entry, clear:" — live repro: ORCL WATCH brief 2026-09-12, both sections
      // printed the identical `g_s4_regime`/`g_s14_cortex` reason strings verbatim. This is the
      // exact duplication shape `play-brief-narrative.ts`'s own "Entry stance" bullet was already
      // fixed to avoid (see its comment: "the reason text has exactly one home below") — just a
      // second, previously-unchecked instance of it, in a different pair of sections. State the
      // count + a pointer here.
      //
      // REPOINTED (Ask Largo standing mandate, 2026-10-08): the "Entry section above" this
      // pointer named was itself found duplicating the SAME full gate text against "Trade manager
      // read" (play-brief.ts's `watchEntrySection`, see its own 2026-10-08 comment) — the "Entry
      // section" was never actually the sole full-text home this comment assumed. Fixed by making
      // `watchEntrySection` ALSO a pointer rather than a third full-text copy, so the one real home
      // is now "Trade manager read" (`watchGateCoaching`, play-brief-narrative-coaching.ts), which
      // renders unconditionally for every watch-bucket play and sits earlier in section order than
      // this "Watch levels" section — repointing here, not re-introducing a second full copy.
      // BUG FIX (2026-10-21, Ask Largo 5-engine cycle, live repro TSLA/SHOP WATCH briefs): this
      // line renders an imperative instruction ("clear N gates [before entry]") keyed purely on
      // `play.gateBlocks.length`, with no check against `gateFramingMootReason()` — unlike THREE
      // sibling renderers of the identical `play.gateBlocks` (`watchEntrySection` play-brief.ts
      // ~864-870, `watchGateCoaching` play-brief-narrative-coaching.ts ~309-312, and
      // `entryTriggerDeadReason` a few lines above in this same file) which all correctly prefix
      // the gate list with "(moot — ...)" whenever clearing the named gates would NOT actually
      // reopen entry (score below the lane floor, thesis still FORMING, or a legacy-exempt-only
      // marker). A 2026-09-14 FINDINGS.md fix reasoned this 4th site was safe because it "already
      // only renders a count with a pointer" — but `watchEntrySection`'s own non-moot branch is
      // the IDENTICAL "count + pointer" shape and still applies the check, disproving that
      // rationale. Live repro: TSLA WATCH read "Before entry, clear: 4 gates" while the SAME
      // envelope's Trade manager read said clearing those same 4 gates is moot (score 31.1, below
      // the lane floor) — a reader following just this section would conclude clearing the gates
      // suffices, the opposite of what the brief's own narrative says two sections earlier.
      const n = play.gateBlocks.length;
      const watchGateMoot = gateFramingMootReason(play);
      lines.push(
        watchGateMoot
          ? `**Also gate-blocked** (moot — ${watchGateMoot}) — see Trade manager read above.`
          : `**Before entry, clear:** ${n} gate${n === 1 ? "" : "s"} — see Trade manager read above.`,
      );
    }
    // BUG FIX (Ask Largo standing mandate, 2026-09-17): this used to re-render `play.entryStatus`
    // as its own "Entry geometry" bullet — but `watchEntrySection` (play-brief.ts, "Entry" section,
    // which composeSwingPlayBrief always places BEFORE this section for a WATCH play) already
    // renders the IDENTICAL fact under the same "Entry geometry" label. Live repro: TSM WATCH brief
    // 2026-09-17, "## Entry" printed "Entry geometry: **AT_TRIGGER**" and "## Watch levels" printed
    // it again as "Entry geometry: **AT TRIGGER**" — same fact, inconsistent formatting (raw enum
    // vs humanized). Same duplication shape as the gateBlocks fix directly above; unlike gateBlocks
    // this is a single scalar with no count worth preserving, so the second copy is dropped rather
    // than replaced with a pointer.
    if (play.flagUnderlyingPx != null) {
      lines.push(`Flag anchor: **${fmtPriceLevel(play.flagUnderlyingPx)}** — track move from here`);
    }
    // BUG FIX (Ask Largo standing mandate, 2026-10-20, live repro TSLA WATCH brief): `trackPct`
    // (command-deck/adapters.ts's `watchUnderlyingTrackPct` — the direction-signed underlying %
    // move since this exact flag anchor, the same "Since flag" number the live board card already
    // shows for this row) is only ever populated on `TerminalPlay` for WATCH/SKIP status
    // (adapters.test.ts pins `open.trackPct === null`) — but the one place that ever rendered it,
    // `pnlSection`'s "Since flag" line (play-brief.ts), is only called from the `bucket === "open"`
    // branch of `composeSwingPlayBrief`. So the line was dead on arrival for the bucket that
    // produces it (open plays have `trackPct: null`) and never reached the bucket that actually has
    // it (watch). A member asking Largo "how far has this moved since it was flagged" on a live
    // WATCH play got the flag anchor and the current spot (a few lines below, via Trade manager
    // read) but never the computed answer, even though the member-facing board card for the
    // identical row already displays it. Surfaced here instead, right beside the anchor it measures
    // from — same wording as the (unreachable) `pnlSection` copy, so nothing new to recognize.
    if (play.trackPct != null) {
      lines.push(`Since flag: **${fmtPct(play.trackPct)}**`);
    }
    // Distinct from the flag anchor above (pinned, historical): this is the CURRENT level a
    // break/reclaim of actually flips entry geometry from PRE_TRIGGER/FORMING to AT_TRIGGER/
    // TRIGGERED. Found live 2026-09-12: a member read "Flag anchor" as this number, which it is
    // not — the two can diverge once a dossier refreshes its plan on a later scan pass.
    if (play.entryTriggerUnderlyingPx != null) {
      const verb = play.direction === "SHORT" ? "Break/reclaim below" : "Break/reclaim above";
      const deadReason = entryTriggerDeadReason(play);
      lines.push(
        deadReason
          ? `Entry trigger: **${fmtPriceLevel(play.entryTriggerUnderlyingPx)}** — ${verb}, but ${deadReason}`
          : `Entry trigger: **${fmtPriceLevel(play.entryTriggerUnderlyingPx)}** — ${verb} this is what actually fires the setup`,
      );
    }
  }

  // The `Thesis **...**` note is a LIVE, ticker-keyed read of whether Night Hawk currently sees an
  // active setup on this name (serving-ingest.ts `thesisLevel`/`thesisNote`) — it is NOT the thesis
  // of the specific CLOSED position being reviewed here, which already resolved. Printed against a
  // closed play it reads as if the (already-decided) trade's thesis were still open, which is a
  // contract violation (identity/direction: whose thesis, and is it live) — so it's closed-bucket-
  // only suppressed; watch/open plays are still evaluating entry, where "is there a live setup here
  // right now" is exactly the right question.
  //
  // GAP FOUND (Ask Largo standing mandate, 2026-10-08, live repro SWING:CRI:1510 and
  // SWING:GLW:1479): the above holds for a NATIVE swing position, where `thesisBreak.level` really
  // is computed from a live multi-signal read. For a Banger-origin merged row it is not —
  // `horizonPlayFromBangerPosition` (banger-lane-merge.ts) stamps `thesisLevel: "intact"` as a fixed
  // literal on EVERY row regardless of price action (there is no per-position thesis dossier for
  // this lane, same root cause `thesisHealthUncalibrated()`/`BANGER_LEDGER_REGIME_LABEL` already
  // exist to catch for the aggregate Thesis-health panel — see thesis-health.ts). Left unguarded
  // here, this line renders unconditionally, so this section printed `Thesis **intact** — below
  // the 2× partial and above the hard stop` for CRI at -59.1% live P&L (mark $0.23 vs stop-rail
  // $0.22 — a 2% cushion from stopping out) and for GLW at -56.1% — a member reads "intact" as a
  // calibrated green light right where this exact section's own next two lines ("Premium stop
  // rail"/"Premium target rail") already state the real, honest mechanical fact (how close to the
  // ladder's own stop/target) far more precisely. Since the label can never say anything but
  // "intact" for this lane until the scale-out engine itself force-exits, and the only substantive
  // content it carries duplicates those two rail lines verbatim, suppress it for Banger-origin rows
  // (`play.regime === BANGER_LEDGER_REGIME_LABEL`, the same sentinel check `thesisHealthUncalibrated`
  // and `serving-lane.ts`'s `attachThesisExplanation` guard already use) rather than let it overclaim
  // a per-position judgment the lane cannot calibrate — the C6 absence principle (omission over
  // fabrication) applied to this one line, not just the aggregate panel.
  const bangerOriginNoRealThesis = play.regime === BANGER_LEDGER_REGIME_LABEL;
  // BUG FIX (Ask Largo standing mandate, 2026-10-20, live repro UNH and MU WATCH briefs, same
  // cycle): this line had no `deadPlayReason(play)` guard, so for a genuinely dead WATCH play
  // (EXTENDED/EXTENDED_CHASE) it rendered "Thesis **intact**" directly beneath this SAME section's
  // own "this level no longer fires the setup" line (entryTriggerDeadReason, a few lines above —
  // which DOES gate on deadPlayReason) and directly contradicted the Verdict section's "Extended
  // past the valid entry window — do not chase; wait for a reset." Two sections of one brief
  // disagreeing about the same fact is the exact bug class this mandate has fixed repeatedly
  // elsewhere in this file (thesisHealthSection, watchEntrySection) — this one line just never got
  // the equivalent guard. Scoped to deadPlayReason's 4 genuinely-dead cases only (not the broader
  // gateFramingMootReason, which also covers FORMING/below-floor plays that are still live and
  // could reasonably still have an "intact" thesis) — see deadPlayReason/gateFramingMootReason's own
  // doc comments above entryTriggerDeadReason.
  const isDeadPlay = deadPlayReason(play) != null;
  if (
    bucket !== "closed" &&
    !bangerOriginNoRealThesis &&
    !isDeadPlay &&
    (play.thesisBreak?.note || play.thesisBreak?.level)
  ) {
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
    //
    // BUG FIX (2026-09-13, Ask Largo standing mandate, live repro COIN WATCH brief): the watch/open
    // branch used to pick "Lose gamma flip" for every LONG and "Reclaim gamma flip" for every SHORT
    // — purely from `play.direction`, never checking which side of the flip spot is ACTUALLY on.
    // "Lose" only makes sense while spot is still above the flip (there's something left to lose);
    // once spot has already fallen through it, the play is already in the unfavorable regime and
    // needs to "Reclaim," not "Lose" it again — and vice versa for a SHORT already above the flip.
    // Live COIN repro: spot 174.98 vs flip 183.49 (spot well BELOW), direction LONG, dealer regime
    // already independently reported a few lines above (line ~310) as "short gamma" — yet this line
    // said "Lose gamma flip 183.49 — dealer posture turns against longs" as if that were still a
    // future risk, contradicting the brief's own dealer-regime line in the same document. This is
    // the exact "same class of bug" `narrateMaxPain` was already fixed for elsewhere in this lane
    // (see play-brief-narrative.ts's own comment on the live RDDT repro, 2026-09-11) — comparing
    // spot to the level itself, not inferring posture from trade direction alone.
    const spotAboveFlip = spot > flip;
    const watch =
      bucket === "closed"
        ? `Now trades **${fmtPriceLevel(spot)}** vs gamma flip **${fmtPriceLevel(flip)}** — where the dealer regime sits since this play closed`
        : play.direction === "LONG"
          ? spotAboveFlip
            ? `Lose gamma flip **${fmtPriceLevel(flip)}** — dealer posture turns against longs`
            : `Reclaim gamma flip **${fmtPriceLevel(flip)}** — needed to restore dealer support for longs`
          : spotAboveFlip
            ? `Lose gamma flip **${fmtPriceLevel(flip)}** — needed to confirm the short thesis`
            : `Reclaim gamma flip **${fmtPriceLevel(flip)}** — invalidates short thesis`;
    lines.push(watch);
  }

  // BUG FIX (Ask Largo standing mandate, 2026-10-08 :40 cycle, live repro SWING:TNGX:1611): this
  // used to hardcode put wall (LONG) / call wall (SHORT) as THE structural level, unaware that
  // `breakTrigger`'s own "Break watch" bullet (and the headline `envelope.invalidation` field)
  // was fixed on 2026-09-15 to pick whichever of put wall/dark pool/GEX king actually sits
  // NEAREST spot — see `resolveInvalidationFocalLevel`'s own doc comment for the full account.
  // Live TNGX repro: GEX king (22.00) sat nearer spot (22.57) than the put wall (20.00), so
  // `envelope.invalidation`/"Break watch" correctly cited 22.00 while this line, in the SAME
  // envelope, said "Structural support node: put wall 20.00" — two different numbers for what
  // both sections present as THE one structural level that matters, with nothing telling the
  // member they're reading two different concepts. Calling the SAME selection here (instead of
  // re-deriving a put-wall-only version) means the two can never again disagree.
  const invalidationLevel =
    spot != null ? resolveInvalidationFocalLevel(play, collectFocalLevels(ctx, spot)) : undefined;
  if (play.direction === "LONG" && invalidationLevel != null) {
    lines.push(`Structural support node: ${invalidationLevel.label} **${fmtPriceLevel(invalidationLevel.price)}**`);
  }
  if (play.direction === "SHORT" && invalidationLevel != null) {
    lines.push(`Structural resistance node: ${invalidationLevel.label} **${fmtPriceLevel(invalidationLevel.price)}**`);
  }

  // DEDUP FIX (Ask Largo standing mandate, 2026-10-18, live repro SWING:TSLA:60): this block used
  // to ALSO render the committed-structural-stop bullet here — added 2026-10-16 (live repro
  // SWING:GOOGL:58) in parallel with an independent, same-date fix to the identical effect in
  // `tradeManagerNarrativeSection` (play-brief-narrative.ts), neither fix aware of the other.
  // Both gate on the same `bucket === "open"` plus the same `invalidationUnderlyingPx`/spot
  // inputs, so whenever one rendered the bullet, the other did too — a byte-identical sentence
  // in two different sections of the same envelope, every time, confirmed live on TSLA's real
  // OPEN brief. `tradeManagerNarrativeSection` keeps sole ownership (it already sits next to the
  // GEX-heuristic "Break watch" bullet this fact complements); this section keeps only its own,
  // distinct "Structural support/resistance node" (GEX heuristic) line above. See
  // play-brief-intel.test.ts's cross-section dedup test for the regression proof.

  // GAP FOUND (Ask Largo standing mandate, 2026-10-13): this section told a member where spot
  // sits vs the gamma flip and vs a live structural level for a closed play, but never answered
  // the one question that actually matters after a stop — did the underlying keep moving in the
  // stop's direction (confirming the exit) or reverse back through it (the exit may have been
  // early)? `play.invalidationUnderlyingPx` is the exact stop level the position closed under —
  // pinned at commit, static, already valid post-close (the same field `closedCoaching`'s "Stop
  // fired... a X% cushion at commit" line already reads, in "Trade manager read" above, which
  // answers a DIFFERENT question — whether the entry was extended at commit, not what the
  // underlying has done since) — comparing it to the spot this section already resolves answers
  // it directly instead of leaving the member to re-derive it from a separate chart. Scoped to
  // `closedReason === "stopped"/"stop"` only: a target/time-stop/thesis exit has no "was the stop
  // too tight" question to answer, so the framing would be a non sequitur there.
  if (
    bucket === "closed" &&
    (play.closedReason === "stopped" || play.closedReason === "stop") &&
    spot != null &&
    play.invalidationUnderlyingPx != null
  ) {
    const inval = play.invalidationUnderlyingPx;
    const reclaimed = play.direction === "SHORT" ? spot < inval : spot > inval;
    // BUG FIX (2026-10-17, Ask Largo standing mandate): same wrong-denominator shape as
    // play-brief-narrative.ts's committedStructuralStopLine (independently written, not a
    // copy-paste) — divided by the stop level itself instead of spot, disagreeing with every
    // sibling "% away from a level" figure elsewhere in the brief, which divides by spot.
    const pctFromInval = Math.abs(((spot - inval) / spot) * 100);
    lines.push(
      reclaimed
        ? `Spot has since reclaimed the stop level (**${fmtPriceLevel(inval)}**) — now **${fmtPriceLevel(spot)}**, ${pctFromInval.toFixed(1)}% back through it; the exit may have been early.`
        : `Spot remains through the stop level (**${fmtPriceLevel(inval)}**) — now **${fmtPriceLevel(spot)}**, confirming the exit.`,
    );
  }

  if (bucket === "open" && play.exitPolicy?.stop_premium != null) {
    const stop = play.exitPolicy.stop_premium;
    // BUG FIX (2026-10-21, Ask Largo 5-engine cycle, live repro MRNA 237.5C 2DTE/positionId 1958):
    // once a trim tranche has fired, the exit engine's own live state machine
    // (deriveScaleOutAction/computeScaleOutTriggerInfo, scale-out.ts) permanently disables this
    // pre-scale hard stop — gated `if (!scaledAlready)`, and post-scale the engine itself returns
    // `hard_stop_price: null` ("the hard stop no longer applies"). Every cushion computation below
    // was unconditional, so a scaled position still got "thesis breaks if mark closes below" — a
    // false claim about a trigger that structurally cannot fire anymore — with the real governing
    // floor (the runner's trailing stop off its peak) never disclosed anywhere. Short-circuit to a
    // distinct render in that case rather than threading a flag through every line below.
    const scaledAlready = hasScaledOut(play.exitPolicy);
    // Cushion = how far (%) the current mark could still fall before hitting the stop — the
    // dollar level alone forces a member to do that subtraction themselves. Only shown when the
    // mark is actually above the stop (the normal case for an OPEN row); omitted rather than
    // shown negative/zero when data is missing or mid a stale-mark edge case — never fabricated.
    //
    // BUG FIX (2026-09-12, Ask Largo standing mandate, live repro EBS OPEN brief): this used to
    // gate ONLY on `play.mark != null && play.mark > 0 && play.mark > stop`, which the TRUE
    // entry-fallback case always satisfies — a banger-lane row with no live quote yet carries
    // `play.mark === play.entry` (banger-lane-merge.ts's `mid = last_mark ?? entry_premium`), and
    // the stop is set below entry by construction, so `mark > stop` is trivially true. EBS
    // (entry/fallback-mark $0.10, stop $0.04) rendered "Premium stop rail: $0.04 — 60% cushion
    // from current mark" here while the SAME envelope's Position section, a few lines above,
    // correctly read "Mark: unknown _(sync quote, no live price yet — do not read as flat)_" — a
    // confident percentage computed from the exact number the document itself says isn't known.
    // Fix: skip the cushion (never the dollar level, which is real regardless) whenever the mark
    // behind it is the true fallback — `optionMarkGenuinelyUnknown` (play-brief-absence.ts,
    // extracted this same fix so `pnlSection`'s already-correct "Mark: unknown" gate and this one
    // can't drift apart a second time).
    //
    // BUG FIX (2026-09-12, live operator conversation, real NN#32 position): the cushion was still
    // computed purely from `play.mark` (the MID), which never checks whether the position's real
    // EXECUTABLE price (`play.execMark`, the bid a long would actually sell into) has already
    // fallen to or through the stop. Live repro: NN carried mark $1.10 / stop $0.78 / execMark
    // (bid) $0.70 — this rendered "29% cushion from current mark", a confident safety-margin claim
    // that does not survive the real bid/ask spread the member would actually have to sell into.
    // Fix: when `execMark` is known and already at/through the stop, drop the percentage and say so
    // plainly instead — the dollar stop level itself is untouched either way.
    //
    // BUG FIX (2026-09-14, Ask Largo standing mandate, live repro SAME NN#32 position): the fix
    // above only closed the BINARY case (bid already at/through the stop). It never touched the
    // percentage itself, so the "close but not yet through" case — the far more common state for a
    // real losing position drifting toward its stop — still computed `cushionPct` from the MID
    // unconditionally. Live repro: NN mark $1.13 / stop $0.78 / execMark (bid) ~$0.85 (execMark
    // above stop, so `executableCushionGone` was false and this branch was never reached) rendered
    // "31% cushion from current mark" when the REAL executable cushion — (0.85-0.78)/0.85 — is only
    // ~8%, on a position already down -42% (mid) / -56% (exec) from entry. A member deciding
    // whether they have room before deciding to exit was reading a number roughly 4x too generous.
    // Fix: prefer `execMark` as the cushion basis whenever it's known (it's already fetched for the
    // Executable P&L bullet a few lines up in "Trade manager read" — same field, same trust level),
    // falling back to the mid only when execMark itself is unavailable — never silently prefer the
    // more optimistic number when the safer one is sitting right there.
    if (scaledAlready) {
      const peakPremiumDollar =
        play.entry != null && play.entry > 0 && play.peak != null && Number.isFinite(play.peak)
          ? play.entry * (1 + play.peak / 100)
          : null;
      const runnerTrail = runnerTrailingStopPremium(peakPremiumDollar);
      lines.push(
        runnerTrail != null
          ? `Premium stop rail: **${fmtUsd(stop)}** _(no longer applies — already scaled)_ — the runner's real floor now is **${fmtUsd(runnerTrail)}** (trailing stop off peak)${railStaleCaveat}`
          : `Premium stop rail: **${fmtUsd(stop)}** _(no longer applies — already scaled)_${railStaleCaveat}`,
      );
    } else {
      const execMark = play.execMark;
      const executableCushionGone = execMark != null && execMark <= stop;
      const cushionBasis = execMark != null && execMark > 0 ? execMark : play.mark;
      const cushionBasisIsExec = execMark != null && execMark > 0;
      const cushionPct =
        cushionBasis != null &&
        cushionBasis > 0 &&
        cushionBasis > stop &&
        !optionMarkGenuinelyUnknown(play) &&
        !executableCushionGone
          ? ((cushionBasis - stop) / cushionBasis) * 100
          : null;
      const cushionNote = executableCushionGone
        ? ` — **no real cushion on the executable side** (bid already at/through this level)`
        : cushionPct != null
          ? ` — ${cushionPct.toFixed(0)}% cushion from current ${cushionBasisIsExec ? "bid" : "mark"}`
          : "";
      lines.push(
        `Premium stop rail: **${fmtUsd(stop)}**${cushionNote} — thesis breaks if mark closes below${railStaleCaveat}`,
      );
    }
  }

  // Symmetric to the stop-cushion block above (Ask Largo standing mandate, 2026-09-18, live repro
  // CRWD:39 OPEN brief): the stop rail gets a fully-gated room% — mark/execMark-preferring,
  // staleness-aware, never fabricated when the mark itself is genuinely unknown — with three
  // separate historical fixes (2026-09-12 x2, 2026-09-14) making that computation increasingly
  // correct. `exitPolicy.target_premium` (the upside rail) is real and already computed, but was
  // NEVER given the equivalent treatment anywhere in the narrative layer — confirmed by exhaustive
  // grep across play-brief.ts/play-brief-narrative.ts/play-brief-narrative-coaching.ts/this file:
  // it only ever appears as a bare dollar figure in "Rails: stop X · target Y" (Management section)
  // and "Manage rails" (tradeManagerNarrativeSection). A member reading the stop side gets "60%
  // cushion from current mark" — no mental math required — while the target side forces them to do
  // exactly the subtraction the stop-cushion fix's own comment names as the reason it was added.
  // Deliberately mirrors the stop block's basis/gating logic (execMark preferred over mid, gated on
  // !optionMarkGenuinelyUnknown) rather than reinventing it, so this can't independently drift into
  // any of the three defect shapes already fixed on the stop side. Omitted (never a negative/zero
  // fabrication) once the basis has already reached or passed the target — a real, if less common,
  // state for a position still open pending its own trim/exit management.
  if (bucket === "open" && play.exitPolicy?.target_premium != null) {
    const target = play.exitPolicy.target_premium;
    // BUG FIX (Ask Largo standing mandate, 2026-09-22, live repro MUU TRIM brief): once a trim
    // tranche priced at/above this same target level has already FIRED (the latched peak reached
    // it), the position already hit this rail and has since pulled back — rendering "X% move
    // still needed to reach target" reads as a fresh, unmet objective a few lines below "Trim
    // ladder: +100% ✓" in the SAME document, a direct self-contradiction. Swing's own
    // SWING_SCALE_OUT_POLICY (exit-policy.ts) prices target_pct identically to its single trim
    // rung's trigger_pct (both 100), so `target_premium` and the fired trim's `premium` are the
    // literal same dollar level — this fires on every swing position that has already scaled out
    // and pulled back below that level, not a rare edge case. Once fired, the rail no longer
    // describes something ahead for the runner (which trails off peak, not toward a second climb
    // to the same number) — omit the room% rather than recompute one off a target already banked.
    const targetAlreadyFired = (play.exitPolicy.trim_levels ?? []).some(
      (t) => t.fired === true && t.premium != null && t.premium >= target,
    );
    const execMarkForTarget = play.execMark;
    const targetBasis = execMarkForTarget != null && execMarkForTarget > 0 ? execMarkForTarget : play.mark;
    const targetBasisIsExec = execMarkForTarget != null && execMarkForTarget > 0;
    const targetRoomPct =
      !targetAlreadyFired &&
      targetBasis != null &&
      targetBasis > 0 &&
      target > targetBasis &&
      !optionMarkGenuinelyUnknown(play)
        ? ((target - targetBasis) / targetBasis) * 100
        : null;
    if (targetRoomPct != null) {
      lines.push(
        `Premium target rail: **${fmtUsd(target)}** — **${targetRoomPct.toFixed(0)}%** move still needed from current ${targetBasisIsExec ? "bid" : "mark"} to reach target${railStaleCaveat}`,
      );
    }
  }

  if (!lines.length) {
    // BUG FIX (Ask Largo standing mandate, 2026-10-08, live repro SWING:NVDA:42 CLOSED brief):
    // the flip/wall lines above are suppressed whenever the GEX matrix is stale
    // (`flipFromStaleGex`/`putWallFromStaleGex`/`callWallFromStaleGex`), which is correct — but
    // this fallback used to say "No gamma flip / GEX wall read available" unconditionally,
    // claiming an outright absence even when a (merely stale) read genuinely exists. That is a
    // real, reproducible self-contradiction within the SAME envelope: `gexPostureSection` reads
    // the identical `ctx.ecosystem.gex_positioning` object and, in that exact case, renders
    // "**Last snapshot** (~163s old) — dealer posture may lag spot" — i.e. it discloses a read
    // DOES exist, just withheld for freshness. "No data" and "data withheld because stale" are
    // different Largo C3 claims; collapsing them to the same sentence is the defect. Distinguish
    // genuine absence (no gex_positioning object at all for this ticker) from stale-and-withheld
    // (object present, past GEX_MATRIX_STALE_MS) and word the closed-bucket fallback honestly.
    const gexAgeMs = gexMatrixAgeMs(gexForLevels, readMs);
    const gexExistsButStale = gexForLevels != null && gexMatrixStale(gexForLevels, readMs);
    const staleAgeLabel = gexExistsButStale ? ageSecondsLabel(gexAgeMs) : null;
    lines.push(
      bucket === "closed"
        ? gexExistsButStale
          ? `GEX read for this name is currently stale${staleAgeLabel != null ? ` (~${staleAgeLabel} old)` : ""} — today's dealer posture withheld, not absent.`
          : "No gamma flip / GEX wall read available for this name since the play closed."
        : "Watch spot vs gamma flip and nearest GEX wall — no extra triggers wired on this row.",
    );
  }

  return {
    title: bucket === "open" ? "What to watch" : bucket === "closed" ? "Since it closed" : "Watch levels",
    body: lines.join("\n\n"),
    // BUG FIX (Ask Largo standing mandate, 2026-10-20): this used to badge the section "bearish"
    // whenever `play.thesisBreak?.level === "break"`, with no reference to `play.direction` —
    // `thesisBreak.level` (thesis-health.ts's `thesisBreakFromHealth`) is a direction-agnostic "has
    // this setup's own edge invalidated" verdict, not a market-direction read. For a SHORT play, a
    // thesis break typically coincides with the underlying breaking UPWARD (the move that
    // invalidates a short) — the opposite of what this line badged. Same defect class already fixed
    // at a sibling call site (thesisHealthSection, play-brief.ts, Largo C5, 2026-09-15: "No
    // section-level bias for a non-directional quality signal — bias is already optional on
    // RichSection") — applying the identical fix here rather than attempting a new direction-aware
    // mapping this section doesn't have the signal to support.
    bias: "neutral",
  };
}

/** Hold plan — time/theta, earnings risk, session stops, thesis-health coaching for open rows. */
export function holdPlanSection(
  ctx: SwingPlayBriefContext,
  narrativeAlreadyNoted?: { roundTrip?: boolean; capture?: boolean; tighten?: boolean },
): RichSection | null {
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
      // BUG FIX (2026-09-21, Ask Largo standing mandate — 4th instance of this file's own
      // round_trip/capture duplication class): actionNarrative's HOLD branch (play-brief-
      // narrative.ts, feeds "Trade manager read", renders for every OPEN play alongside this
      // section) independently renders "Health fading — tighten stop or trim into any bounce."
      // for the SAME health < 45 condition whenever rec is neither TRIM nor SELL — the common
      // case for a fading-but-still-held thesis. Same underlying advice ("tighten/reduce risk,
      // thesis is degrading") restated in different prose across two sections a member reads back
      // to back, exactly the pattern the round_trip/capture guards two lines below already close
      // for THIS section — this one line was the gap those guards never covered, because the call
      // site only ever derived roundTrip/capture flags from narrative.body, never a tighten one.
      if (h.health < 45 && !narrativeAlreadyNoted?.tighten) {
        lines.push("**Tighten risk** — thesis fading; don't add size");
      }
    }
    // Peak giveback is grounded in committed trade marks — independent of thesis-health calibration.
    // Honest RELATIVE retracement via mfe-capture.ts, not a percentage-POINT subtraction of two
    // already-percentage numbers (same fix as the two sibling call sites, FINDINGS 2026-09-10).
    // captureFloor=70 is the LEAST sensitive of the three call sites — this bullet only renders
    // when thesisHealth is already present (a live open play with a computed thesis read already
    // surfaced above), so a smaller giveback is less likely to be worth a second callout here.
    //
    // BUG FIX (2026-09-21, Ask Largo standing mandate — third instance of #5362's duplication
    // class, live repro SWING:BLSH:1179): this section is only ever independently VISIBLE to a
    // member in the expandIntel=1 expanded view (the default collapsed view folds it entirely
    // into "Trade manager read" without restating its content) — but actionNarrative
    // (play-brief-narrative.ts) already renders the identical round_trip/capture<75 giveback fact
    // into "Trade manager read" unconditionally, and since this section's own capture<70 floor is
    // a strict subset of actionNarrative's <75, and round_trip is kind-gated (not threshold-gated)
    // in both places, this bullet duplicated actionNarrative's fact on every expanded-view read
    // whenever either branch fired. Same shape as the CLOSED-play sibling lessonsSection's own
    // roundTripAlreadyNoted/captureAlreadyNoted guards just below in this file — this OPEN-play
    // path never got the equivalent.
    const giveback = mfeCaptureOutcome(play.pnlPct, play.peak, null);
    if (giveback?.kind === "round_trip") {
      if (!narrativeAlreadyNoted?.roundTrip) {
        // NOT "consider trim into strength" — the play has already round-tripped PAST breakeven
        // into a loss, so there is no strength left to trim into; that phrasing was the exact
        // self-contradiction fixed in actionNarrative's TRIM branch (FINDINGS 2026-09-10,
        // "trim-strength-line-vs-round-trip") — this call site independently computes the same
        // giveback and was missed by that fix's blast-radius check. Matches the wording
        // play-brief-narrative.ts's SELL branch already uses for the identical fact.
        lines.push(
          `**Round-tripped past breakeven** — was up **${giveback.peakPct.toFixed(0)}%** at peak, now **${giveback.exitPnlPct.toFixed(0)}%** — consider protecting what's left`,
        );
      }
    } else if (giveback?.kind === "capture" && giveback.capturePct < 70 && !narrativeAlreadyNoted?.capture) {
      // BUG FIX (Ask Largo standing mandate, 2026-10-07): same root cause as the two sibling
      // call sites in play-brief-narrative.ts (actionNarrative's capture branch and
      // degradedReadLine's givebackBit) — `giveback.capturePct` divides the RUNNER-only
      // `play.pnlPct` against `play.peak`, so once a trim has already banked a tranche, "Gave
      // back X% from peak" describes only the still-open runner, not the whole position. Worse
      // here than the sibling fix: the trailing clause ("consider trim into strength") is
      // actively wrong once a trim already fired — there is no trim left to "consider," it
      // already happened (the exact self-contradiction already fixed for the round_trip branch
      // immediately above, via the "NOT 'consider trim into strength'" comment — this capture
      // branch shared the same bug and was missed by that fix's own blast-radius check).
      const anyTrimBanked = (play.exitPolicy?.trim_levels ?? []).some((t) => t.fired);
      lines.push(
        anyTrimBanked
          ? `Gave back **${(100 - giveback.capturePct).toFixed(0)}%** of the runner since peak — part of this position is already banked at a profit; consider protecting what's left`
          : `Gave back **${(100 - giveback.capturePct).toFixed(0)}%** from peak — consider trim into strength`,
      );
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
 *  advisory two sections up in this file — see that comment.
 *
 *  BUG FOUND (2026-09-18, Ask Largo standing mandate): the fix above only deduped the round-trip
 *  FACT sentence — the ADVICE clause attached to it was never covered, and neither was the sibling
 *  stop-loss advice. Live repro (NN:32, CLOSED, real production play-brief): "Trade manager read"
 *  rendered "**Round-tripped past breakeven** — was up 24% at peak, closed at -60%; tighten at
 *  first trim rail next time." AND "**Stop fired** (stopped) — check if entry was extended past
 *  invalidation.", then "Lessons" — right below it in the same response — independently rendered
 *  "**Gave back the move** — next time tighten at first trim rail or thesis fade." and "Stop loss
 *  — check if invalidation level was respected or entry was extended." Same trim-rail advice and
 *  same invalidation-check advice, restated near-verbatim in two different sections a member reads
 *  one after another — exactly the "disconnected bullet-dump" pattern the standing mandate flags,
 *  not the "independent evidence" the original roundTripAlreadyNoted fix's own test intended to
 *  preserve (that test never exercised this dedup path, since it never passed the new flags).
 *  `adviceAlreadyNoted`/`stopAdviceAlreadyNoted` close the same gap the same way: the call site
 *  checks whether "Trade manager read" already carries the identical advice text and, only then,
 *  skips restating it here — every OTHER independent lesson (MFE capture number, archetype tag,
 *  exec-vs-mid slippage, "partial capture" verdicts) is untouched.
 *
 *  BUG FOUND (2026-09-18, Ask Largo standing mandate, live repro CRWD:19 CLOSED/target): the three
 *  flags above only ever gate the round_trip kind (plus the capture<35 "gave back" branch, which
 *  happens to reuse the identical advice string). The capture>=75 "Strong exit discipline" branch
 *  — arguably the MOST common closed-play outcome, since it fires on any well-managed winner — had
 *  no suppression flag at all: "Trade manager read" (closedCoaching, capture>=75 branch) rendered
 *  "**Strong discipline** — captured 85.7% of peak; replicate trim timing." and this section
 *  independently restated the same verdict one section later: "MFE capture: 85.7% of peak move" +
 *  "**Strong exit discipline** — banked most of the move; replicate trim ladder timing." Same
 *  disconnected-bullet-dump pattern as the round_trip fix, on the one branch it didn't cover.
 *  `captureAlreadyNoted` closes it the same way — only the restated VERDICT sentence is
 *  suppressed; the raw "MFE capture: X% of peak move" line (independent, and asserted by an
 *  existing test to survive analogous suppression, same as "Peak was") is untouched. */
export function lessonsSection(
  play: TerminalPlay,
  roundTripAlreadyNoted?: boolean,
  adviceAlreadyNoted?: boolean,
  stopAdviceAlreadyNoted?: boolean,
  captureAlreadyNoted?: boolean,
  /**
   * BUG FIX (2026-10-18, Ask Largo × Night Hawk Swings mandate): the bare `Exit: **{reason}**`
   * line below used to fire unconditionally. `closedCoaching` (play-brief-narrative-coaching.ts)
   * already states the same closedReason fact in "Trade manager read" (rendered immediately above
   * "Lessons" in the same response) for every reason OUTSIDE its two special-cased phrasings
   * ("thesis", "stopped"/"stop") via a generic `Exit reason: **${r}**` fallback — so for the
   * common target/ratchet/flat cases, the exact same word appeared twice, two sections apart.
   * Live repro (2026-10-18, real closed positions): BE/MSFT (target), PYPL (flat) all rendered
   * both "Exit reason: **target**"/"**flat**" and "Exit: **target**"/"**flat**". Same restatement
   * class this function has already gated four other times (see the BUG FIX comments above); this
   * was the one branch with zero gating. Scoped narrowly to the reasons that hit the generic
   * fallback — thesis/stopped/stop keep their own distinct phrasing in "Trade manager read" (a
   * paraphrase, not a duplicate), so this line still renders for those.
   */
  exitReasonAlreadyNoted?: boolean,
): RichSection | null {
  if (play.status !== "CLOSED") return null;
  const lines: string[] = [];
  // Hoisted out of the `if (play.peak != null...)` block below so the closedReason branch
  // (target/ratchet) can see it too — see the BUG FIX note at that call site for why.
  let outcome: ReturnType<typeof mfeCaptureOutcome> = null;
  if (play.peak != null && play.exitPnlPct != null) {
    outcome = mfeCaptureOutcome(play.exitPnlPct, play.peak, play.mfeCapturePct);
    lines.push(`Peak was **${fmtPct(play.peak)}** · exited **${fmtPct(play.exitPnlPct)}**`);
    if (outcome?.kind === "round_trip") {
      if (!roundTripAlreadyNoted) {
        lines.push(`**Round-tripped past breakeven** — up **${fmtPct(outcome.peakPct)}** at peak, closed at **${fmtPct(outcome.exitPnlPct)}**.`);
      }
      // BUG FIX (2026-09-18, Ask Largo standing mandate): `closedCoaching`'s round_trip branch
      // (play-brief-narrative-coaching.ts) always emits its advice clause IN THE SAME SENTENCE as
      // the "Round-tripped past breakeven" fact -- never independently -- but has TWO different
      // phrasings depending on outcome.peakPct: "tighten at first trim rail next time" when
      // peakPct > 20, or "a trim rail wouldn't have helped here; review entry timing or thesis
      // strength instead" when peakPct <= 20. `adviceAlreadyNoted`'s call-site derivation
      // (buildIntelSections) only string-matches the first phrasing, so live repro AAPL:38
      // (2026-09-18, CLOSED, peak +10.2% <= 20 threshold, real production play-brief): "Trade
      // manager read" said "a trim rail wouldn't have helped here; review entry timing or thesis
      // strength instead" while "Lessons" two sections later independently said "next time
      // tighten at first trim rail or thesis fade" -- directly CONTRADICTING advice on the same
      // trade, not just a restatement. Since the round-trip fact and its advice are always one
      // atomic sentence in closedCoaching, `roundTripAlreadyNoted` being true already proves the
      // advice (whichever phrasing) was also stated -- gate on it directly instead of chasing
      // every future phrasing `adviceAlreadyNoted`'s string match would need to enumerate.
      if (!adviceAlreadyNoted && !roundTripAlreadyNoted) {
        lines.push("**Gave back the move** — next time tighten at first trim rail or thesis fade.");
      }
    } else if (outcome?.kind === "capture") {
      const capture = outcome.capturePct;
      lines.push(`MFE capture: **${fmtPct(capture)}** of peak move`);
      if (capture >= 75) {
        if (!captureAlreadyNoted) {
          lines.push("**Strong exit discipline** — banked most of the move; replicate trim ladder timing.");
        }
      } else if (capture < 35) {
        if (play.peak > 20) {
          if (!adviceAlreadyNoted) {
            lines.push("**Gave back the move** — next time tighten at first trim rail or thesis fade.");
          }
        } else {
          // FINDINGS 2026-09-20 (Ask Largo × Night Hawk Swings mandate): the sibling branch above
          // ("Gave back the move ... tighten at first trim rail") only fires when `play.peak > 20`
          // -- correctly so, since a peak that small never reaches a real trim rail, so "tighten at
          // first trim rail" would be nonsensical advice. But the `else` was simply missing, so a
          // closed play with a small peak (<=20%) that still captured less than 35% of it (e.g.
          // peak +12%, exit +3%) rendered the bare "MFE capture: X% of peak move" fact with NO
          // verdict line at all -- silently less informative than every other capture band. No live
          // closed position has hit this exact combination yet (every low-peak trade to date either
          // round-tripped to a loss, handled separately above, or nearly fully captured its small
          // peak, landing in the >=75% band) -- caught by code-reading the if/else chain against its
          // sibling `closedCoaching` (play-brief-narrative-coaching.ts), which IS exhaustive here via
          // a plain catch-all `else`. Reuses the same "a trim rail wouldn't have fired" framing this
          // file's round_trip branch already established for the identical peak<=20 constraint, so
          // the reasoning stays consistent across both outcome kinds. Unconditional (no dedup flag,
          // like the sibling "Partial capture" branch below) -- closedCoaching's own text for this
          // exact bucket is the unrelated generic "review runner vs trim policy" phrase, so there is
          // no restatement risk to gate against.
          lines.push(
            "**Small move, weakly captured** — the peak never reached a trim rail; review entry timing or thesis strength instead.",
          );
        }
      } else if (capture >= 35 && capture < 75) {
        lines.push("**Partial capture** — review whether runner policy matched the setup volatility.");
      }
    }
  }
  if (play.closedReason) {
    const reason = play.closedReason.replace(/_/g, " ");
    const exitReasonIsRestatement =
      play.closedReason !== "thesis" && play.closedReason !== "stopped" && play.closedReason !== "stop";
    if (!(exitReasonIsRestatement && exitReasonAlreadyNoted)) {
      lines.push(`Exit: **${reason}**`);
    }
    if (play.closedReason === "target" || play.closedReason === "ratchet") {
      // BUG FIX (2026-09-21, Ask Largo × Night Hawk Swings mandate): this line used to fire
      // UNCONDITIONALLY whenever closedReason was "target"/"ratchet", with no regard for how the
      // trade actually played out. Live repro (KKR closed play, real production play-brief,
      // peak +203.8%, exit +50.5%, MFE capture 24.8%): the SAME "Lessons" section rendered
      // "MFE capture: 24.8% of peak move" (and, when not already deduped into "Trade manager
      // read", "Gave back the move — next time tighten at first trim rail or thesis fade.")
      // immediately followed by "Mechanical exit fired as designed — thesis or ladder did its
      // job." — flatly contradictory framing of the identical exit two lines apart: one calls it
      // a giveback worth tightening next time, the other calls it a job well done. Exactly the
      // "disconnected bullet-dump" contradiction class this function's own history (see the
      // round_trip/capture>=75 BUG FIX comments above) already fixed twice for other branches;
      // this was the one branch with zero gating at all. A mechanically-correct exit (the ladder
      // fired at its programmed level) is not the same claim as "this was a good outcome" — only
      // say so when the capture was NOT already flagged as weak.
      const weakCapture =
        outcome?.kind === "round_trip" || (outcome?.kind === "capture" && outcome.capturePct < 35);
      if (weakCapture) {
        lines.push(
          "Exit mechanism fired correctly, but the ladder banked little of the peak — see MFE capture above; review trim timing, not the mechanism.",
        );
      } else {
        lines.push("Mechanical exit fired as designed — thesis or ladder did its job.");
      }
    } else if (play.closedReason === "stopped" || play.closedReason === "stop") {
      if (!stopAdviceAlreadyNoted) {
        lines.push("Stop loss — check if invalidation level was respected or entry was extended.");
      }
    } else if (play.closedReason === "thesis") {
      lines.push("Thesis break exit — pillar degradation was the signal; review which pillar failed first.");
    }
  }
  const lessonsArchetypeLabel = archetypeLabelFromRaw(play.archetype);
  if (lessonsArchetypeLabel) {
    lines.push(`Archetype **${lessonsArchetypeLabel}** — tag this outcome in your playbook review.`);
  }
  // REMOVED (2026-10-18, Ask Largo × Night Hawk Swings mandate; already catalogued as
  // SWING-SYSTEM-CTO-AUDIT-2026-09-06.md item #52, never actioned until now): this used to be a
  // `play.execPnlPct != null && play.exitPnlPct != null && |delta| > 5` gated "Executable vs mid
  // exit ... slippage on the tape" bullet. Swing has no executable-fill-vs-mid grading concept —
  // terminalPlayFromHorizon (adapters.ts) unconditionally sets `execPnlPct: null` whenever
  // `status === "CLOSED"`, and SwingClosedDeckSource (closed-plays.ts) never supplies an alternate
  // value, so the gate could never clear for any real closed swing position (confirmed live:
  // execPnlPct is null on all 56 real closedDeck rows). Fabricating a real exec-vs-mid comparison
  // to make this fire would need a genuine fill-price field swing doesn't track anywhere — out of
  // scope for a minimal fix, and the Largo product contract's "omission is honest, fabrication is
  // not" rule argues against inventing one just to satisfy this bullet. Deleted rather than wired.
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

/**
 * Meridian desk catalyst calendar — richer than UW earnings stub alone.
 *
 * Largo C2 (2026-09-15, Ask Largo standing mandate): `slice.as_of` was captured on the type but
 * never read here — under `withServerCache`'s stale-while-revalidate path a degraded Benzinga
 * upstream can keep serving the same stored payload (and its true, un-bumped `as_of`) for up to
 * 10 minutes (server-cache.ts's `MAX_STALE_AGE_MS`), so "calendar is quiet" could read as a fresh
 * claim while actually minutes stale — the one section in this file with zero freshness
 * disclosure while every sibling (GEX/Vector) explicitly caveats staleness. Prefixed the same
 * "Last snapshot" pattern those use rather than inventing a new one.
 */
export function meridianCatalystSection(ctx: SwingPlayBriefContext): RichSection | null {
  const slice = ctx.meridian;
  if (slice?.unavailable) {
    return {
      title: "Meridian catalysts",
      body: "Catalyst calendar unavailable on this read — not evidence of a quiet calendar.",
    };
  }
  // Ask Largo standing mandate, readMs-anchor sweep follow-up to #5351: ctx is a required param
  // here — prefer its stamped readMs over a fresh wall-clock sample.
  const readMs = ctx.readMs ?? Date.now();
  const stale = meridianCatalystStale(slice, readMs);
  const ageLabel = stale ? ageSecondsLabel(meridianCatalystAgeMs(slice, readMs)) : null;
  const staleLead = stale
    ? `**Last snapshot**${ageLabel != null ? ` (~${ageLabel} old)` : ""} — catalyst calendar may lag.\n\n`
    : "";
  if (!slice?.items.length) {
    return {
      title: "Meridian catalysts",
      body:
        staleLead +
        "No catalysts in the **14-day** Meridian window on this read — calendar is quiet, not missing.",
    };
  }

  // `catalystsSection` (arsenal.earnings, a separate UW-sourced read) already states this
  // ticker's own upcoming earnings date when it has one. When Meridian's Benzinga-backed
  // timeline independently carries an earnings-kind item for the SAME ticker on the SAME
  // date, that is the same fact told twice from two uncoordinated sources with no
  // cross-reference — drop the duplicate here rather than restate it (audit #16, found
  // auditing catalystsSection/meridianCatalystSection for narrative-vs-bullet-dump quality
  // per the Largo product contract). Any OTHER Meridian item (a different date, a different
  // kind, or a genuinely different ticker on an index read) still renders untouched.
  const arsenalEarningsDate = ctx.ecosystem?.arsenal?.earnings?.earnings_date ?? null;
  const ticker = ctx.play.ticker?.toUpperCase() ?? null;
  const items = arsenalEarningsDate
    ? slice.items.filter(
        (i) => !(i.kind === "earnings" && i.ticker === ticker && i.date === arsenalEarningsDate),
      )
    : slice.items;

  if (!items.length) {
    return {
      title: "Meridian catalysts",
      body:
        staleLead +
        "This ticker's only catalyst in the **14-day** Meridian window is the earnings print already covered above.",
    };
  }

  const lines = items.map(formatMeridianItem);
  const droppedForWindow = slice.total_matched - slice.items.length;
  if (droppedForWindow > 0) {
    lines.push(`_${droppedForWindow} more in window — open Meridian desk for full lane._`);
  }
  return { title: "Meridian catalysts", body: staleLead + lines.join("\n") };
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

/**
 * Macro rates + market breadth when arsenal fetched index context.
 *
 * BUG FIX (Ask Largo standing mandate, 2026-10-13): this section rendered `yield_10_year` and
 * `cpi` with zero vintage disclosure, unlike every sibling freshness-aware section in this file
 * (GEX/Vector/Meridian/fundamentals all carry a "Last snapshot ... may lag" or an explicit date).
 * Live-verified the same day: treasury yields dated 2026-10-08 (5 days old) alongside a CPI print
 * dated 2026-08-01 (73 days old) — CPI's own monthly cadence means that gap is normal, not a fetch
 * failure, but a member reading "CPI **334.1**" with no date next to a 5-day-old rates line has no
 * way to tell it apart from a current print. `EcosystemArsenalMacro.treasury_as_of`/`cpi_as_of`
 * (ecosystem-context.ts) carry each series' own real date now — surfaced here per-value instead of
 * the single combined `as_of` (which silently inherits the FRESHER series' date, see that field's
 * own doc comment), same discipline `formatMeridianItem` already applies to earnings dates.
 */
export function macroTapeSection(eco: EcosystemContext | null): RichSection | null {
  const arsenal = eco?.arsenal;
  if (!arsenal) return null;
  const lines: string[] = [];
  if (arsenal.macro) {
    const m = arsenal.macro;
    const parts: string[] = [];
    if (m.yield_10_year != null) {
      const asOf = m.treasury_as_of ? ` (${m.treasury_as_of})` : "";
      parts.push(`10Y **${m.yield_10_year.toFixed(2)}%**${asOf}`);
    }
    if (m.curve_10y_1y_spread != null) parts.push(`10s-1s **${m.curve_10y_1y_spread.toFixed(2)}**`);
    if (m.cpi != null) {
      const asOf = m.cpi_as_of ? ` (${m.cpi_as_of} print)` : "";
      parts.push(`CPI **${m.cpi.toFixed(1)}**${asOf}`);
    }
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
  sessionDate: string | null = null,
): RichSection | null {
  if (!eco) return null;

  const nh = eco.nighthawk_recent;
  if (!nh?.outcome || !nh.edition_for) return null;

  // STALENESS GATE (found 2026-09-12, live GOOGL brief): `nighthawk_recent` is "the last time
  // THIS TICKER appeared in a Legacy edition" with NO date filter — for most tickers that is not
  // today or yesterday, it is however long ago Legacy last happened to feature this name. This
  // section used to narrate it unconditionally as "Night Hawk Legacy's last pick on this name
  // (<edition_for>) is still unresolved — weigh that track record ... before sizing", regardless
  // of age. Live reproduction: GOOGL's `edition_for` read 2026-08-26 (17 days before the
  // 2026-09-12 session) and the section still told the member to weigh it "before sizing" as if
  // it were current context — while `unavailableSourcesFor()` (play-brief-absence.ts), fixed
  // 2026-09-10 for this EXACT same underlying staleness (its own comment: "GOOG's
  // nighthawk_recent.edition_for read 2026-08-03 (5+ weeks old)"), correctly labeled the same
  // fact "no recent Legacy edition for this ticker" and marked it non-retryable — the chip and
  // the narrative section disagreed about the same data in the same payload. This mirrors that
  // fix's own bound (a normal within-week gap, incl. weekends) rather than reinventing one: within
  // the window the pick is still plausibly "recent track record," beyond it the honest read is
  // "this ticker simply hasn't come up in Legacy lately," which has nothing useful to say about
  // sizing today's setup, so the section is suppressed rather than asserting stale context as if
  // fresh. `sessionDate` defaults to null (skip the gate) so existing callers/tests that construct
  // this section without a session date keep their prior behavior; the real caller below now
  // always passes `ctx.sessionDate`.
  // For a CLOSED play, "today" is the wrong reference point for this gate — a Legacy pick can
  // fall within 4 days of TODAY while still being dated AFTER the trade's own exit (live repro
  // 2026-09-12, AAPL positionId 36: closed 2026-09-04, nighthawk_recent.edition_for read
  // 2026-09-11 — 7 days AFTER exit but only 1 day before "today" at read time). The tail wording
  // for this bucket ("for reference against the ... setup this play traded") asserts the pick
  // could have informed that decision — impossible if it postdates the trade. Anchor the gate to
  // the play's own exit date for CLOSED, `sessionDate` (today) otherwise; `gapDays < 0` (the
  // Legacy pick date, in ET, is AFTER the reference date) is the anachronism this adds — a case
  // the sessionDate-only gate could never trip since Legacy history is never dated after "today".
  const referenceDate =
    bucket === "closed" ? (play.exitAt ? etSessionDate(Date.parse(play.exitAt)) : null) : sessionDate;
  if (referenceDate) {
    const gapDays = daysBetweenYmd(nh.edition_for, referenceDate);
    if (gapDays === null || gapDays < 0 || gapDays > 4) return null;
  }

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
    // "Night Hawk Legacy's" (not the ambiguous "Night Hawk's") — inside a SWING play brief, "last
    // swing" reads as "this same Swing engine's own history on this name," but `nighthawk_recent`
    // is Legacy's next-day-digest pick history, a different product entirely (confirmed by the
    // `edition_for` field name, Legacy's own vocabulary). Same underlying data source and confusion
    // as the "Night Hawk Legacy" absence-chip fix (2026-09-10) — this is the sibling gap in the
    // section that actually narrates it, not just the chip that flags its absence.
    body: `Night Hawk Legacy's last pick on this name (**${nh.edition_for}**) ${verdict} ${tail}`,
  };
}

/**
 * GEX dealer posture — gamma/vanna context for the swing.
 *
 * Bucket-gated (Ask Largo standing mandate, 2026-09-12) same as `chartTechnicalsSection`/
 * `wallDynamicsSection` this same pass: a CLOSED play's dealer posture here is TODAY's read, not
 * the posture the trade actually traded under — disclosed rather than left implicit.
 */
export function gexPostureSection(ctx: SwingPlayBriefContext): RichSection | null {
  const gex = ctx.ecosystem?.gex_positioning;
  if (!gex) return null;
  // Ask Largo standing mandate, readMs-anchor sweep follow-up to #5351: ctx is a required param
  // here — prefer its stamped readMs over a fresh wall-clock sample.
  const readMs = ctx.readMs ?? Date.now();
  const stale = gexMatrixStale(gex, readMs);
  const ageLabel = stale ? ageSecondsLabel(gexMatrixAgeMs(gex, readMs)) : null;
  const lines: string[] = [];
  if (stale) {
    lines.push(
      `**Last snapshot**${ageLabel != null ? ` (~${ageLabel} old)` : ""} — dealer posture may lag spot.`,
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
  // BUG FIX (2026-09-18, Ask Largo standing mandate): same false-zero precision defect fixed
  // in play-brief.ts's tradeManagerNarrativeSection (PR #5227, live ABTC $10.15 repro) — a raw
  // net_gex/1e6 .toFixed(1) collapses any real, signed net GEX under ~$50k to "0.0M", which reads
  // as "no dealer exposure" when a real signed value exists. That fix only touched the narrative
  // call site; this GEX-posture evidence block computes the identical ratio from the identical
  // gex.net_gex field independently and had the same defect.
  if (!stale && gex.net_gex != null) lines.push(`Net GEX: **${formatDealerDollars(gex.net_gex)}**`);
  // Ask Largo research finding (2026-10-14, 5-engine monitor cycle): VEX/DEX/CHARM are computed
  // into this SAME gex_positioning object (getGexPositioning — the identical function Thermal's
  // own formatPositioningBlock reads for its "Net GEX / VEX / DEX / CHARM" desk line) and were
  // already loaded into every swing brief's ctx.ecosystem with no extra fetch, but never surfaced
  // here — a dead-wired-data gap, not an absent data source. CHARM in particular matters for a
  // multi-day swing hold: charm-driven dealer delta decay intensifies pinning/acceleration as
  // expiry nears, which a 0DTE-only reader would never need to know. Same false-zero-safe
  // formatter + null-gating as net_gex above; vanna/dex/charm regime-read text rides alongside
  // the number when present, and the whole line omits cleanly when the field is null (C3).
  if (!stale && gex.net_vex != null) {
    lines.push(
      `Net VEX (vanna): **${formatDealerDollars(gex.net_vex)}**${gex.vanna_regime_read ? ` — ${gex.vanna_regime_read}` : ""}`,
    );
  }
  if (!stale && gex.net_dex != null) {
    lines.push(
      `Net DEX (delta): **${formatDealerDollars(gex.net_dex)}**${gex.dex_regime_read ? ` — ${gex.dex_regime_read}` : ""}`,
    );
  }
  if (!stale && gex.net_charm != null) {
    lines.push(
      `Net CHARM (pinning): **${formatDealerDollars(gex.net_charm)}**${gex.charm_regime_read ? ` — ${gex.charm_regime_read}` : ""}`,
    );
  }
  // Recompute "nearest wall" from the SAME preferred (Vector-ladder-first) call/put walls
  // "Levels on chart" renders, instead of the raw `gex.nearest_wall` (GEX-matrix-only call_wall/
  // put_wall) — see preferredGexWalls' header for the live MSTR:33 evidence this fixes.
  const preferred = preferredGexWalls(ctx);
  const wallOnly =
    preferred.spot != null
      ? nearestWallFromLevels(
          preferred.callWallFromStaleGex ? null : preferred.callWall,
          preferred.putWallFromStaleGex ? null : preferred.putWall,
          preferred.spot,
        )
      : null;
  // BUG FIX (Ask Largo standing mandate, 2026-10-20): see nearestLevelWithFlip's own header —
  // the wall-only answer above never considered the gamma flip, so this line could name a wall
  // "nearest" while chartLevelsSection's own "Nearest wall" line (which DOES consider the flip)
  // named the flip for the SAME spot in the SAME envelope.
  const nearest =
    preferred.spot != null
      ? nearestLevelWithFlip(wallOnly, preferred.flip, preferred.flipFromStaleGex, preferred.spot)
      : null;
  if (!stale && nearest != null) {
    const kindLabel = nearest.kind === "flip" ? "gamma flip" : nearest.kind;
    lines.push(
      `Nearest wall: **${fmtPriceLevel(nearest.strike)}** (${kindLabel}, ${nearest.distance_pts.toFixed(1)} pts from spot **${fmtPriceLevel(preferred.spot!)}**)`,
    );
  }
  if (!stale && gex.change_pct != null) lines.push(`Underlying session: **${fmtPct(gex.change_pct)}**`);
  if (!lines.length) return null;
  if (statusBucket(ctx.play) === "closed") {
    lines.unshift("_Current dealer posture — not what this trade traded under._");
    const sessionNote = closedMarketSessionNote(vectorOf(ctx), gex, readMs);
    if (sessionNote) lines.splice(1, 0, sessionNote);
  }
  return { title: "GEX posture", body: lines.join("\n") };
}

/**
 * Wall bead dynamics — building/fading nodes from Vector wall history.
 *
 * `bucket` (Ask Largo standing mandate, 2026-09-12): same current-vs-as-traded gap fixed on
 * `chartTechnicalsSection`/`chartLevelsSection`/`gexPostureSection` this same pass — these are
 * TODAY's building/fading wall events, unrelated to the specific closed position under review.
 */
export function wallDynamicsSection(
  vec: VectorFullState | null,
  sessionDate?: string | null,
  bucket: "watch" | "open" | "closed" = "open",
  // Ask Largo standing mandate, readMs-anchor sweep follow-up to #5351/#5392/#5393: this and
  // `vectorDeskSection` below were the last two bare `Date.now()` staleness anchors in the swing
  // play-brief family — every sibling (`gexPostureSection`, `chartLevelsSection`,
  // `catalystsSection`, `dataFreshnessSection`, `meridianCatalystSection`, ...) already prefers
  // the brief's single stamped `ctx.readMs` so every section in one brief agrees on "now" even
  // if the request straddles a staleness boundary while composing. `ctx` is optional (defaults to
  // a fresh `Date.now()`) so pre-existing callers/tests that pass only `(vec, sessionDate, bucket)`
  // keep compiling and behaving identically; the real production call site
  // (`composeSwingPlayBrief`) now passes it.
  ctx?: SwingPlayBriefContext | null,
): RichSection | null {
  const readMs = ctx?.readMs ?? Date.now();
  // BUG FIX (2026-10-17, Ask Largo standing mandate, live repro SWING:GOOGL:58 CLOSED brief):
  // this used to return null unconditionally on a stale Vector snapshot, so this section vanished
  // entirely on CLOSED briefs — the exact same dead-code-on-CLOSED shape `vectorDeskSection` was
  // fixed for the same day (see its comment): Vector is almost always stale by the time a
  // position closes, so CLOSED was the default case being eaten here, not a rare edge, and the
  // closed-bucket disclosure code a few lines below (`closedMarketSessionNote`) was unreachable.
  // Bucket-gating the return restores wall-event history for CLOSED while leaving OPEN/WATCH's
  // stale-omission behavior untouched.
  if (vectorSnapshotStale(vec, readMs, sessionDate) && bucket !== "closed") return null;
  const events = vec?.wallEvents ?? [];
  if (!events.length) return null;
  // BUG FIX (Ask Largo standing mandate, 2026-10-20): `vec.wallEvents` is chronologically ASCENDING
  // (oldest-first) — `eventsFromWallHistory` (vector-wall-events.ts) builds it by iterating wall-
  // history samples forward, so index 0 is the earliest detected wall transition and the last index
  // is the newest. Every sibling reader of this SAME field takes from the END to get the most
  // recent activity: `wallDynamicsCoaching` (play-brief-narrative-coaching.ts) does `events.slice(-2)`;
  // `tradeManagerNarrativeSection`'s own "Wall just moved" bullet (play-brief-narrative.ts) explicitly
  // does `walls[walls.length - 1]`. This section's `.slice(0, 5)` took the FIRST 5 — the 5 OLDEST
  // events — backwards relative to its own title ("Wall bead dynamics — building/fading nodes") and
  // doc comment ("these are TODAY's building/fading wall events"). On a session with more than 5
  // wall events, this section showed stale, superseded activity from hours earlier while the same
  // brief's "Trade manager read" section, built from the exact same array, correctly cited the
  // newest shift — two sections of one brief disagreeing about what "current" wall activity is.
  const lines = events
    .slice(-5)
    .map((e) => {
      const at = e.strike != null ? ` @ ${fmtPriceLevel(e.strike)}` : e.flip != null ? ` @ flip ${fmtPriceLevel(e.flip)}` : "";
      return `• **${e.kind.replace(/_/g, " ")}**${at} — ${e.message}`;
    });
  if (bucket === "closed") {
    lines.unshift("_Current wall activity — not what this trade traded under._");
    const sessionNote = closedMarketSessionNote(vec, ctx?.ecosystem?.gex_positioning, readMs);
    if (sessionNote) lines.splice(1, 0, sessionNote);
  }
  return { title: "Wall dynamics", body: lines.join("\n") };
}

/** Vector desk play read — entry zone, targets, invalidation from play engine. */
export function vectorDeskSection(
  vec: VectorFullState | null,
  sessionDate?: string | null,
  bucket: "watch" | "open" | "closed" = "open",
  // Ask Largo standing mandate, readMs-anchor sweep follow-up to #5351/#5392/#5393: same
  // trailing-optional-`ctx` pattern as `wallDynamicsSection` just above — see its comment for the
  // full rationale. This was the other of the two remaining bare `Date.now()` anchors in the
  // swing play-brief family.
  ctx?: SwingPlayBriefContext | null,
): RichSection | null {
  const p = vec?.play;
  if (!p) return null;
  const readMs = ctx?.readMs ?? Date.now();
  const vectorStale = vectorSnapshotStale(vec, readMs, sessionDate);
  const lines: string[] = [];
  // CLOSED plays: `p` is Vector's CURRENT read on the ticker, computed fresh at request time —
  // it has nothing to do with the specific, already-resolved position under review. Rendering the
  // full entry-zone/targets/invalidation/"Watch now" directive block (unchanged since before this
  // fix) for a closed play reads as a live, actionable call to re-enter a trade that already
  // exited, and badges it bullish/bearish as if it were guidance on the closed position — a
  // contract violation (identity/direction: whose call is this, and is it live) of the same shape
  // already fixed for the "Watch levels" section (see watchForSection's closed-bucket handling
  // above). Closed briefs keep only the informational grade/conviction snapshot, framed as
  // "since it closed" market context, with no directives and a forced-neutral bias.
  //
  // FIX (Ask Largo standing mandate, 2026-10-17, live repro SWING:TSLA:57 / SWING:GOOGL:58 CLOSED
  // briefs): this branch used to sit AFTER the `vectorStale` early return below, so on a real
  // CLOSED-bucket read — where Vector's live feed has stopped updating and is therefore almost
  // always stale by the time the position closed — the generic "Last snapshot ... may lag spot"
  // branch fired first and this function never reached its own closed-bucket framing or the
  // #6115 closedMarketSessionNote() disclosure, making that fix dead code in exactly the scenario
  // it was built for. `bucket === "closed"` is checked first now so the closed framing (and its
  // market-closed disclosure, which itself falls back to the GEX matrix when Vector is stale) is
  // reachable regardless of Vector's own staleness.
  if (bucket === "closed") {
    lines.push(`Current Vector read: grade **${p.grade}** · conviction **${p.conviction}** (since this play closed)`);
    const sessionNote = closedMarketSessionNote(vec, ctx?.ecosystem?.gex_positioning, readMs);
    if (sessionNote) lines.push(sessionNote);
    return { title: "Vector desk", body: lines.join("\n\n"), bias: "neutral" };
  }
  if (vectorStale) {
    const ageLabel = ageSecondsLabel(vec?.dataAgeMs);
    lines.push(
      `**Last snapshot**${ageLabel != null ? ` (~${ageLabel} old)` : ""} — Vector desk read may lag spot.`,
    );
    if (p.grade) lines.push(`Vector desk grade: **${p.grade}** (from prior snapshot)`);
    // FINDINGS 2026-09-20: `if (!lines.length) return null` here was dead code -- the "Last
    // snapshot ... may lag spot" line a few lines above is pushed unconditionally in this branch,
    // so `lines.length >= 1` always holds by this point regardless of whether `p.grade` is set.
    // Removed rather than left as harmless-looking defensive code, since a guard that can never
    // fire reads as intentional (implying a real path returns null here) when none exists.
    return { title: "Vector desk", body: lines.join("\n\n"), bias: "neutral" };
  }
  lines.push(`**${p.headline}** · grade **${p.grade}** · conviction **${p.conviction}**`);
  if (p.thesis) lines.push(p.thesis);
  // BUG FIX (Ask Largo standing mandate, 2026-10-20, fresh-angle technicals audit): a genuinely
  // dead WATCH candidate (deadPlayReason's 4 cases — invalidated, entry-window expired, contract
  // expired, extended past the valid entry window) still reached this branch with none of the
  // live-directive content below gated on it — unlike watchForSection's own "Thesis intact" line
  // (play-brief-intel.ts, fixed the same day, same mandate), which got exactly this guard. A dead
  // WATCH play's own top-level Verdict already says e.g. "Extended past the valid entry window —
  // do not chase; wait for a reset.", but this section — reachable via the live, member-facing
  // `expandIntel=1` toggle ("Show detail") since Vector desk is otherwise folded into the
  // narrative — kept printing concrete "Entry zone"/"Targets"/"Watch now" directives for the
  // SAME dead setup, directly contradicting the brief's own verdict. Mirrors vectorDeskSection's
  // own closed-bucket design one branch up: keep the informational headline/grade/conviction/
  // thesis snapshot, drop the actionable directives, force a neutral bias.
  const isDeadPlay = ctx?.play ? deadPlayReason(ctx.play) != null : false;
  if (isDeadPlay) {
    return { title: "Vector desk", body: lines.join("\n\n"), bias: "neutral" };
  }
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
  // Ask Largo standing mandate, #5351 follow-up: this whole section independently sampled the
  // real wall clock (Date.now()) at every staleness check below instead of ctx.readMs, the one
  // canonical "now" composeSwingPlayBrief stamps before any section builds. #5351 fixed the exact
  // same defect shape for watchForSection/confluenceCoaching (two sections disagreeing on the SAME
  // Vector wall because each sampled Date.now() at a different real instant during compose); this
  // section carries the identical risk against sibling sections that DO already anchor on
  // ctx.readMs (watchForSection) or on the identical field via collectBriefUnavailableSources
  // (fixed in the same PR) — e.g. this section could call a mark "as of <time>" with no staleness
  // qualifier while the unavailableSources[] chip for the SAME mark says "stale", if the two
  // Date.now() samples straddled the 18-minute SWING_OPTION_MARK_STALE_MS cutoff.
  const readMs = ctx.readMs ?? Date.now();
  if (play.markAsOf) {
    // Largo C2 (2026-09-16): this line printed the raw mark stamp unconditionally, the one
    // section named specifically for freshness disclosure never actually checking it — while
    // the SAME envelope's evidence[] and unavailableSources[] both correctly computed staleness
    // off this identical field via optionMarkIsStale (collectOptionMarkStalenessAbsence,
    // play-brief-absence.ts), producing an internal contradiction: a member could see "stale"
    // in the unavailable-source chip and evidence array, "as of <time>" with no qualifier here.
    // Live repro: CRWD:39/AAPL:38/AAPL:37 all carried a 2026-09-15 16:00 ET mark (prior session's
    // close print) read the next morning, ~14h past the 18-minute SWING_OPTION_MARK_STALE_MS bound.
    lines.push(
      optionMarkIsStale(play, readMs)
        ? `Option mark **stale** — last synced **${etStampFromIso(play.markAsOf)}**`
        : `Option mark as of **${etStampFromIso(play.markAsOf)}**`,
    );
  } else if (play.markIsSync && playExpectsLiveOptionMark(play.status)) {
    lines.push("**Mark age unknown** — sync quote without timestamp; treat P&L as indicative");
  }
  // FINDINGS 2026-09-12: scan/Vector/GEX/HELIX staleness all measure whether TODAY's live desk
  // state is current — a fact that stops being meaningful the moment a play is CLOSED (a
  // historical record, not a live position). Left ungated, these fire FOREVER once any time has
  // passed since close, exactly the failure mode `play-brief-absence.ts`'s
  // `collectBriefUnavailableSources` already documents and gates for its own (structured
  // unavailableSources/UnavailableChip) output. Reproduced live 2026-09-12 on a real CLOSED INTC
  // brief read a full week after the play closed: "Swing scan: prior session ... today's discovery
  // not yet run" and "HELIX flow: pipeline stale" both still rendered, describing "today" for a
  // trade that closed 2026-09-04. The option-mark lines above are untouched — `playExpectsLiveOptionMark`
  // already scopes the live-mark-staleness claim to OPEN/HOLD/TRIM, and a bare `markAsOf` timestamp
  // (when present) is a historical fact, not a live-staleness claim.
  //
  // BUG FOUND (Ask Largo standing mandate, 2026-10-07): the 2026-09-12 fix above only gated on
  // `isClosed`. `collectBriefUnavailableSources` was separately widened on 2026-09-19 to also
  // suppress these checks for a dead-but-not-closed WATCH candidate (`deadPlayReason` non-null —
  // entry-window expired/extended/invalidated/contract-expired), via its own local `isNotLive`.
  // This section never got the same widening, so the two halves of the SAME envelope disagreed:
  // live repro NTAP (today, `entryStatus: "EXTENDED_CHASE"`, status `COMMIT` i.e. still a WATCH
  // row, not CLOSED) — this section's "Data freshness" prose asserted "HELIX flow: **pipeline
  // stale**" while the SAME brief's structured `unavailableSources` was `[]` and `confidence.why`
  // read "Every live source this brief reads from resolved cleanly this cycle." One EXEMPT
  // predicate (`isSwingPlayStaleCheckExempt`, entry-enterability.ts) now backs both call sites so a
  // third one can't silently reintroduce the same split.
  const isStaleCheckExempt = isSwingPlayStaleCheckExempt(play);
  if (!isStaleCheckExempt) {
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
    // Largo C2 (2026-09-16): these two lines each reimplemented a partial staleness check
    // instead of calling the shared, already-tested helpers this same file uses correctly for
    // the identical fields elsewhere (gexMatrixStale at lines 429/458/706/765/802/1213;
    // vectorAgeStale's sibling vectorSnapshotStale below). Two concrete gaps the raw comparisons
    // missed: (1) `vec.dataAgeMs` is stamped `Number.POSITIVE_INFINITY` on future clock skew
    // (withReadContext()) — `Infinity > 120_000` still trips the old branch, but
    // `Math.round(Infinity / 1000)` renders the literal string "Vector data **Infinitys** old";
    // (2) a `null` dataAgeMs (unparseable `asOf`) skipped the line entirely even when
    // `vec.freshness === "stale"` or a parseable `vec.asOf` would correctly flag it via
    // `vectorAgeStale`'s fallback paths — same for a negative (future-skewed) `gexAgeMs`, which
    // `gexAgeMs > GEX_MATRIX_STALE_MS` silently reads as fresh instead of failing closed the way
    // `gexMatrixStale` already does. Using the shared boolean gates the rendering; the raw ages
    // still drive the seconds label when they're finite and non-negative.
    if (vectorAgeStale(vec, readMs)) {
      const ageMs = vec?.dataAgeMs;
      const ageLabel =
        typeof ageMs === "number" && Number.isFinite(ageMs) && ageMs >= 0
          ? `${Math.round(ageMs / 1000)}s`
          : "clock-skewed";
      lines.push(`Vector data **${ageLabel}** old — levels may lag live spot`);
    }
    const gexAgeMs = gexMatrixAgeMs(ctx.ecosystem?.gex_positioning, readMs);
    if (gexMatrixStale(ctx.ecosystem?.gex_positioning, readMs)) {
      const gexLabel =
        typeof gexAgeMs === "number" && Number.isFinite(gexAgeMs) && gexAgeMs >= 0
          ? `${Math.round(gexAgeMs / 1000)}s`
          : "clock-skewed";
      lines.push(`GEX matrix **${gexLabel}** old — dealer posture may lag spot`);
    }
    if (ctx.ecosystem?.flow_feed_fresh === false) {
      lines.push(
        "HELIX flow: **pipeline stale** — tape read may lag; not evidence of quiet flow",
      );
    }
  }
  if (!lines.length) return null;
  // `bias` is a DIRECTIONAL read (bullish/bearish/neutral/mixed) — the UI renders it as a
  // literal "Bullish"/"Bearish" pill (BiasPill, src/features/largo/answer/BieChips.tsx). This
  // section carries only data-QUALITY facts (mark timestamp missing, scan/vector/GEX staleness,
  // HELIX pipeline lag) — none of them are a market read, so tagging the section "bearish"
  // whenever the mark lacks a live timestamp told members the desk saw a bearish signal on
  // plays that could just as easily be LONG, with zero connection to actual direction. Always
  // "neutral" here — a caveat about data quality, never a synthesized market call.
  return { title: "Data freshness", body: lines.join("\n"), bias: "neutral" };
}

/**
 * BUG FOUND (Ask Largo standing mandate, 2026-09-20): every section builder below is called bare —
 * no try/catch anywhere in this function or in `composeSwingPlayBrief` (play-brief.ts). Each builder
 * chases nontrivial `??`/`.reduce()`/`.toFixed()`/`.slice()` reads off live ecosystem/vector/GEX/
 * flow data (this file's own long "GAP FOUND"/"BUG FOUND" comment history is a record of just how
 * many null-shape edge cases have already been hit live), so a single new edge case in ANY ONE of
 * the ~20 sections throws straight through this function, through `composeSwingPlayBrief`, to the
 * API route's top-level catch (`src/app/api/market/swing/play-brief/route.ts`), which returns
 * `{available:false, degraded:true}` (503) — the ENTIRE brief (Verdict/Position/Management included)
 * disappears for that member even though 19 of the 20 intel sections, and every other section in the
 * envelope, built perfectly fine. Live repro constructed for the regression test below: a
 * `TerminalPlay.factors` value that is not an array (a realistic shape drift from a degraded upstream
 * read, since `factors` is typed non-optional but nothing here defends against a bad payload) throws
 * inside `whyThisSetupSection`'s `.slice(0, 10)` and previously took the whole brief down with it.
 *
 * Fix: each builder call is now wrapped in `safeSection`, which catches, logs (server-side only —
 * never surfaced to the member), and treats a throw exactly like the section's own legitimate `null`
 * return — silently omitted, not fatal. This is the composition-level twin of this file's own
 * "absence must be disclosed, never silent" principle (Largo contract C3): a section that can't be
 * built is exactly as absent as a section that decided it had nothing to say, and one broken section
 * must never cost a member the other nineteen. Scope: this fix covers the per-section calls in THIS
 * function (the largest, most numerous surface, every one of them already `RichSection | null`-
 * shaped, making the wrap a pure behavior-preserving change on the success path). The bucket-specific
 * top-level sections in `composeSwingPlayBrief` (Verdict/Entry/Management/Position/Outcome) and the
 * evidence/levels builders are a separate, smaller surface not touched here — a natural follow-up,
 * not folded in to keep this a single-issue PR.
 */
// BUG FOUND (Ask Largo standing mandate, 2026-10-10): the 2026-10-07 fix on `safeCompose`
// (play-brief.ts) gave evidence/levels an `onFailure` hook specifically because a silent []
// fallback is indistinguishable from "we checked and there's genuinely nothing" — but that same
// fix explicitly deferred extending the identical pattern to THIS function's 20 `safeSection`
// calls ("not duplicated here (single-issue PRs, per this repo's standing policy)"). The gap it
// described applies here unchanged: when a section builder throws (#5288's own repro — a
// malformed/degraded upstream row at runtime despite a required-field type), the section is
// omitted with no record anywhere the model-facing envelope reads — not `unavailableSources`, not
// `confidence` — so the member/Largo reading the brief cannot tell a dropped "Chart technicals" or
// "Catalysts & news" apart from a bucket that was never meant to show one. Zero live occurrences
// found in 7 days of CloudWatch `/ecs/blackout-production` logs for `"intel section"` at time of
// writing — this is a latent disclosure-contract gap, not an active one — but the fix is the same
// proven, already-shipped `onFailure` pattern, so completing it here is the natural scoped follow-up
// rather than a new design. `onFailure` defaults to a no-op so every existing caller (including the
// many direct `buildIntelSections(ctx, bucket)` calls in this file's own tests) is unaffected.
function safeSection<T>(title: string, build: () => T, onFailure?: (label: string) => void): T | null {
  try {
    return build();
  } catch (error) {
    console.error(`[swing/play-brief] intel section "${title}" threw — omitting it, not failing the brief`, error);
    onFailure?.(title);
    return null;
  }
}

/** Build all intelligence sections for the current play state. */
export function buildIntelSections(
  ctx: SwingPlayBriefContext,
  bucket: "watch" | "open" | "closed",
  opts?: { collapseIntel?: boolean; onFailure?: (label: string) => void },
): RichSection[] {
  const { play, ecosystem } = ctx;
  const vec = vectorOf(ctx);
  const out: RichSection[] = [];
  const onFailure = opts?.onFailure;

  const narrative = safeSection("Trade manager read", () => tradeManagerNarrativeSection(ctx, bucket), onFailure);
  if (narrative) out.push(narrative);

  const whySetup = safeSection("Why this setup", () => whyThisSetupSection(play, bucket), onFailure);
  if (whySetup) out.push(whySetup);

  const book = safeSection("Book context", () => bookContextSection(play, ctx.openBook), onFailure);
  if (book) out.push(book);

  const trackRecord = safeSection(
    "Archetype track record",
    () => archetypeTrackRecordSection(play, ctx.archetypeTrackRecord, ctx.readMs ?? Date.now()),
    onFailure,
  );
  if (trackRecord) out.push(trackRecord);

  const tickerRecord = safeSection(
    "Ticker track record",
    () => tickerTrackRecordSection(play, ctx.tickerTrackRecord),
    onFailure,
  );
  if (tickerRecord) out.push(tickerRecord);

  const cortexRead = safeSection("Cortex read", () => cortexReadSection(play), onFailure);
  if (cortexRead) out.push(cortexRead);

  const rank = safeSection(
    "Lane rank",
    () =>
      laneRankSection(play, ctx.laneRows, {
        scanAsOf: ctx.scanAsOf,
        scanSessionDay: ctx.scanSessionDay,
        sessionDate: ctx.sessionDate,
      }),
    onFailure,
  );
  if (rank) out.push(rank);

  const technicals = safeSection(
    "Chart technicals",
    () => chartTechnicalsSection(vec, ctx.sessionDate, bucket, ctx),
    onFailure,
  );
  if (technicals) out.push(technicals);

  const levels = safeSection("Chart levels", () => chartLevelsSection(ctx), onFailure);
  if (levels) out.push(levels);

  const gex = safeSection("GEX posture", () => gexPostureSection(ctx), onFailure);
  if (gex) out.push(gex);

  const walls = safeSection(
    "Wall dynamics",
    () => wallDynamicsSection(vec, ctx.sessionDate, bucket, ctx),
    onFailure,
  );
  if (walls) out.push(walls);

  const vdesk = safeSection(
    "Vector desk",
    () => vectorDeskSection(vec, ctx.sessionDate, bucket, ctx),
    onFailure,
  );
  if (vdesk) out.push(vdesk);

  const flow = safeSection("Flow intel", () => flowIntelSection(ecosystem, play, ctx.sessionDate), onFailure);
  if (flow) out.push(flow);

  const catalysts = safeSection("Catalysts", () => catalystsSection(ecosystem, ctx), onFailure);
  if (catalysts) out.push(catalysts);

  const meridian = safeSection("Meridian catalyst", () => meridianCatalystSection(ctx), onFailure);
  if (meridian) out.push(meridian);

  const meridianPeer = safeSection("Meridian peer", () => meridianPeerSection(ctx), onFailure);
  if (meridianPeer) out.push(meridianPeer);

  const macro = safeSection("Macro tape", () => macroTapeSection(ecosystem), onFailure);
  if (macro) out.push(macro);

  const consensus = safeSection(
    "Desk consensus",
    () => deskConsensusSection(ecosystem, play, bucket, ctx.sessionDate),
    onFailure,
  );
  if (consensus) out.push(consensus);

  const fresh = safeSection("Data freshness", () => dataFreshnessSection(ctx), onFailure);
  if (fresh) out.push(fresh);

  const watchFor = safeSection("Watch for", () => watchForSection(ctx, bucket), onFailure);
  if (watchFor) out.push(watchFor);

  if (bucket === "open") {
    // Same cross-section restatement guard as the closed-bucket lessonsSection below — narrative
    // is composed above (line ~1883) before this call, so "Trade manager read"'s own
    // actionNarrative giveback fact is already known here.
    const roundTripAlreadyNoted = narrative?.body?.includes("Round-tripped past breakeven") ?? false;
    const captureAlreadyNoted = narrative?.body?.includes("Gave back") ?? false;
    // Closes the low-thesis-health "tighten risk" gap the two flags above don't cover — see the
    // BUG FIX note on holdPlanSection's own "Tighten risk" line (2026-09-21) for the live-shape
    // repro (any OPEN play with a HOLD-class recommendation and health < 45).
    const tightenAlreadyNoted =
      narrative?.body?.includes("Health fading — tighten stop or trim into any bounce") ?? false;
    const hold = safeSection(
      "Hold plan",
      () =>
        holdPlanSection(ctx, {
          roundTrip: roundTripAlreadyNoted,
          capture: captureAlreadyNoted,
          tighten: tightenAlreadyNoted,
        }),
      onFailure,
    );
    if (hold) out.push(hold);
  }

  if (bucket === "closed") {
    const roundTripAlreadyNoted = narrative?.body?.includes("Round-tripped past breakeven") ?? false;
    // Same restatement class as roundTripAlreadyNoted above, closing the gap that fix left open —
    // see lessonsSection's own doc comment (2026-09-18) for the live repro.
    const adviceAlreadyNoted = narrative?.body?.includes("tighten at first trim rail next time") ?? false;
    // GAP FOUND (2026-09-29, Ask Largo standing mandate, live repro HUT:43 CLOSED/stopped):
    // closedCoaching's 2026-09-28 fix (play-brief-narrative-coaching.ts) replaced its generic
    // "check if entry was extended past invalidation" ask with a computed cushion answer
    // ("entry X vs invalidation Y, a Z% cushion at commit...") whenever entryTriggerUnderlyingPx/
    // invalidationUnderlyingPx are both present — but this dedup flag still only matched the OLD
    // generic phrasing, which the new answer no longer contains. So on every stopped CLOSED play
    // with both levels pinned (the common case, not the absence edge case), "Trade manager read"
    // rendered the real cushion answer while "Lessons" — one section below, same response —
    // independently re-asked the exact question that section had just answered. Same restatement
    // class as roundTripAlreadyNoted/adviceAlreadyNoted above; gate on the same structural
    // condition closedCoaching uses to pick its phrasing (mirrors its trig!==0/finite check)
    // rather than string-matching prose that a future rewording can drift out from under again.
    const stopCushionAnswered =
      play.closedReason === "stopped" &&
      typeof play.entryTriggerUnderlyingPx === "number" &&
      Number.isFinite(play.entryTriggerUnderlyingPx) &&
      play.entryTriggerUnderlyingPx !== 0 &&
      typeof play.invalidationUnderlyingPx === "number" &&
      Number.isFinite(play.invalidationUnderlyingPx);
    const stopAdviceAlreadyNoted =
      (narrative?.body?.includes("check if entry was extended past invalidation") ?? false) ||
      stopCushionAnswered;
    // Closes the capture>=75 "Strong exit discipline" gap the flags above left open — see
    // lessonsSection's own doc comment (2026-09-18) for the live repro (CRWD:19).
    const captureAlreadyNoted = narrative?.body?.includes("replicate trim timing") ?? false;
    // Closes the bare "Exit: **{reason}**" restatement gap — see lessonsSection's own doc comment
    // (2026-10-18) for the live repro. Safe, collision-free dedup key: "Exit reason: **" appears
    // nowhere else in src/lib/swing.
    const exitReasonAlreadyNoted = narrative?.body?.includes("Exit reason: **") ?? false;
    const lessons = safeSection(
      "Lessons",
      () =>
        lessonsSection(
          play,
          roundTripAlreadyNoted,
          adviceAlreadyNoted,
          stopAdviceAlreadyNoted,
          captureAlreadyNoted,
          exitReasonAlreadyNoted,
        ),
      onFailure,
    );
    if (lessons) out.push(lessons);
  }

  if (opts?.collapseIntel === false) return out;

  return collapseRedundantIntelSections(out, {
    hasNarrative: Boolean(narrative),
    bucket,
  });
}
