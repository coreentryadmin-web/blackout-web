/**
 * Swing Play Intelligence Engine — deterministic, real-time play brief composer.
 * No Anthropic calls. Every claim traces to platform data with null-honesty.
 */
import type { BieAnswerEnvelope, BieBias, BieEvidence, BieFreshness, BieLevel, BieUnavailableSource } from "@/lib/bie/answer-envelope";
import { freshnessFromAgeMs, freshnessFromObservedMs } from "@/lib/bie/answer-envelope";
import { describeVectorFreshness, type VectorFreshnessBlock } from "@/lib/bie/vector-state-freshness";
import type { GexPositioning } from "@/lib/providers/gex-positioning";
import { nearestWallFromLevels } from "@/lib/providers/gex-nearest-wall";
import { normalizeImpliedVol } from "@/lib/providers/options-snapshot";
import { formatDealerDollars } from "@/lib/swing/format-nonzero";
import type { VectorFullState } from "@/lib/bie/vector-full-state";
import type { ConfluenceZone } from "@/features/vector/lib/vector-confluence";
import { buildRichEnvelope, type RichSection } from "@/lib/bie/rich-narrative";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import { playContractHeadline } from "@/features/nighthawk/command-deck/play-card-lifecycle";
import { playGradeLabel, playQualityPct } from "@/features/nighthawk/command-deck/play-card-display";
import { swingActionDisplay } from "@/features/nighthawk/command-deck/play-card-lifecycle";
import { thesisStrengthPct } from "@/features/nighthawk/command-deck/terminal-display";
import type { SwingPlayBriefContext, SwingPlayBriefResult } from "./play-brief-types";
import { archetypeLabelFromRaw, ARCHETYPE_META, SWING_ARCHETYPES, SWING_SUB_LANES, type SwingSubLane } from "./taxonomy";
import { graduatedArchetypeEntry } from "./calibration-cache";
import { swingPlayBriefConfidence } from "./play-brief-confidence";
import {
  collectBriefUnavailableSources,
  confluenceZoneKindsLabel,
  fundamentalsAncient,
  fundamentalsFreshnessTag,
  gexMarketSessionNote,
  gexMatrixAgeMs,
  gexMatrixStale,
  archetypeTrackRecordIsStale,
  optionMarkGenuinelyUnknown,
  optionMarkIsStale,
  playExpectsLiveOptionMark,
  darkPoolStale,
  resolveGammaPosture,
  trustedHelixFlow,
  vectorSnapshotStale,
} from "./play-brief-absence";
import { buildIntelSections, entryTriggerDeadReason, nearestLevelWithFlip } from "./play-brief-intel";
import { checkPortfolioOverlap } from "./portfolio";
import { describeThemeOverlap } from "./theme-cluster";
import { parseSwingPlayId } from "./play-brief-resolve-pure";
import { deadPlayReason, gateFramingMootReason } from "./entry-enterability";
import { buildStructureLadder } from "./play-brief-ladder";
import { resolveBreakInvalidation } from "./play-brief-narrative";
import { briefContentKey, extrasFromBriefResponse, snapshotFromBrief } from "./play-brief-diff";
import { fmtOptionUsd as fmtUsd, fmtPct, fmtPremium, fmtPriceLevel } from "@/lib/fmt-money";
import { etStampFromDateOrIso, etStampFromIso } from "@/lib/largo/temporal/bar-session-date";
import { calibratedThesisPillars, thesisHealthUncalibrated } from "./thesis-health";
import { canonicalTicker } from "@/lib/largo/core/entities";

function biasFromDirection(dir: string): BieBias {
  return dir === "SHORT" ? "bearish" : dir === "LONG" ? "bullish" : "neutral";
}

/**
 * Largo C5/C8 fix (2026-10-19, built on the 2026-10-18 staged finding
 * `docs/audit/findings-staging/2026-10-18-closed-brief-direction-thesis.md`): `BieAnswerEnvelope`
 * carried `bias` (normalized) and a `headline` that NAMES the direction/recommendation in prose,
 * but never an explicit `direction`/`thesis` field a programmatic reader could bind to — for ANY
 * bucket, not just CLOSED (the finding tested CLOSED chains specifically, but the root cause —
 * `buildRichEnvelope` only ever sets `bias`, never `direction`/`thesis` — was never bucket-scoped;
 * confirmed by reading `composeSwingPlayBrief` itself before this fix, no WATCH/OPEN branch set
 * either field either).
 *
 * `thesis` is synthesized here rather than invented: it reuses the EXACT same fields the Verdict
 * section's own opening line (`verdictLines[0]`, just below) and the envelope `headline` already
 * compute — direction, the contract headline, and the identical
 * action-label -> recommendation -> status fallback chain used in both other places — so `thesis`
 * can never state a claim the Verdict card or headline doesn't already make, just as one flat
 * sentence instead of markdown. For a CLOSED play this naturally resolves `verb` to
 * `swingActionDisplay`'s own closedReason-driven label (TARGET/STOPPED/SCRATCH) when known, same
 * as the Verdict line and headline — genuinely data-grounded, never a fabricated claim about why
 * the position closed. Archetype is appended only when the play actually carries one.
 */
function briefThesis(
  play: TerminalPlay,
  contractHeadline: string,
  action: { label: string } | null,
  archetypeLabel: string | null,
): string {
  const verb = action?.label ?? play.recommendation ?? play.status;
  const archetypeSuffix = archetypeLabel ? ` · ${archetypeLabel}` : "";
  return `${play.direction} ${contractHeadline} — ${verb}${archetypeSuffix}.`;
}

function statusBucket(play: TerminalPlay): "watch" | "open" | "closed" {
  if (play.status === "CLOSED") return "closed";
  if (play.status === "OPEN" || play.status === "HOLD" || play.status === "TRIM") return "open";
  return "watch";
}

function thesisHealthSection(play: TerminalPlay): RichSection | null {
  const h = play.thesisHealth;
  if (!h) return null;
  const uncalibrated = thesisHealthUncalibrated(h);
  if (uncalibrated) {
    // Largo C6 gap (2026-09-21, Ask Largo standing mandate): don't blank the ENTIRE panel just
    // because one pillar is a generic default — show whichever pillars genuinely calibrated (e.g.
    // persistence/entry-geometry live-derived from real price/trigger reads) instead of discarding
    // them alongside a flow_corroboration pillar that's honestly empty for this position (a
    // non-flow archetype like SECTOR_ROTATION, or a commit that predates/skipped G-S6 enforcement).
    // The blended AGGREGATE % still stays withheld — it can't honestly represent a pillar with no
    // real read — see calibratedThesisPillars's doc comment for the full trace.
    const rows = calibratedThesisPillars(h)
      .map((p) => {
        const deltaStr = p.deltaPts != null ? ` (Δ ${p.deltaPts >= 0 ? "+" : ""}${p.deltaPts.toFixed(1)} pts)` : "";
        return `• **${p.label}** — ${p.currentLabel ?? "unknown"}${deltaStr}`;
      })
      .join("\n");
    return {
      title: "Thesis health",
      body: rows
        ? `Aggregate score withheld — not every pillar input is wired for this position yet.\n\n${rows}`
        : "Inputs not wired for committed positions — aggregate score withheld; pillar breakdown not shown.",
      bias: "neutral",
    };
  }
  const rows = h.pillars
    .map((p) => {
      const deltaStr = p.deltaPts != null ? ` (Δ ${p.deltaPts >= 0 ? "+" : ""}${p.deltaPts.toFixed(1)} pts)` : "";
      return `• **${p.label}** — ${p.currentLabel ?? "unknown"}${deltaStr}`;
    })
    .join("\n");
  // Largo C5 (2026-09-15, Ask Largo standing mandate): `h.health` is a direction-agnostic "is the
  // setup intact" score (persistence/entry-geometry/flow/regime/theta pillars) — it says nothing
  // about market direction. Mapping it straight to bullish/bearish meant a SHORT play with a
  // healthy thesis (health>=65, price correctly falling) badged the section green "Bullish" —
  // the literal opposite of what the trade is betting, and a direct contradiction of the envelope's
  // own top-level `biasFromDirection(play.direction)` (BieSectionCard renders `section.bias` as a
  // color-coded BiasPill, so this reached real UI, not just inert JSON). No section-level bias for
  // a non-directional quality signal — `bias` is already optional on RichSection.
  //
  // BUG FIX (2026-10-07, Ask Largo standing mandate): `rungFromHealth`/`rungLabel` (thesis-health.ts)
  // name every band purely off the ABSOLUTE health %, with no reference to whether anything moved
  // since commit — "Minor drift"/"Weakening"/"Degraded"/"Broken" all read as PROCESS words implying
  // decay happened, but a position can sit in any of those bands on day one, forever, just because
  // its ENTRY was imperfect (e.g. a chase-risk entry geometry), never having changed at all. Live
  // repro (SWING:INTC:50, 2026-10-07): the brief rendered "**77%** · Minor drift" directly above
  // five pillar rows EVERY one of which showed "(Δ +0.0 pts)" — the headline word "drift" directly
  // contradicted the itemized evidence one line below it, with nothing in the section telling the
  // reader which one was true. `computeSwingThesisHealth` already computes exactly this "did
  // anything move" signal (`h.moves`, falling back to the literal string "All swing pillars
  // unchanged since commit." when no pillar faded/lost — the same fallback
  // play-brief-narrative-coaching.ts's thesisPillarCoaching already gates its own "What moved" line
  // on) but this section never read it. Surface it right next to the band label instead of leaving
  // a reader to infer "unchanged" by checking all five deltas are exactly zero themselves.
  //
  // BUG FIX (Ask Largo standing mandate, 2026-10-14): `h.moves` staying at its fallback
  // "unchanged" sentinel is NOT proof nothing moved — four of the five pillars can never trip it
  // (see `roundTripSinceCommit`'s doc comment, zerodte/thesis-health.ts, for the full structural
  // account) and a real round-trip through a genuine favorable peak falls through every one of
  // `moves`'s own triggers unless it happens to cross the -40% backstop or flip thesisBreak.
  // Live repro 2026-10-14, SWING:INTC:56 (peak +15.3% -> trough -36.6%, currently -36.5%): this
  // line read "unchanged since commit" in the SAME envelope whose "Trade manager read" section
  // correctly narrates "Round-tripped past breakeven ... consider protecting what's left" — two
  // sections of one brief disagreeing about the same fact. `roundTripSinceCommit` is computed
  // independently (not via `moves`, which has a second consumer — thesisPillarCoaching's "What
  // moved" line — that already renders this same fact; reusing `moves` here would duplicate it).
  //
  // BUG FIX (Ask Largo standing mandate, 2026-10-16, Bug 4 of the standing Ask Largo x Night Hawk
  // Swings mandate — live GOOG repro, positionId 59): the 2026-10-14 fix above only covered a
  // round-trip into a NEGATIVE P&L (`roundTripSinceCommit`, `mfeCaptureOutcome(...)?.kind ===
  // "round_trip"`). A position that retraces hard from peak but stays net-POSITIVE still printed
  // this exact contradiction — "unchanged since commit" beside a "Gave back 85% of peak —
  // consider protecting runner" bullet two sections down, same brief. `materialGivebackSinceCommit`
  // (thesis-health.ts) closes this using the IDENTICAL `capturePct < 75` threshold that giveback
  // narrative already uses, so the two can never disagree again — see its own doc comment
  // (zerodte/thesis-health.ts) for the full account. Supersedes the narrower `!h.roundTripSinceCommit`
  // check (a strict subset of what `materialGivebackSinceCommit` now covers).
  const noDriftSinceCommit =
    (h.moves?.[0]?.includes("unchanged") ?? false) && !h.materialGivebackSinceCommit;
  const headline = noDriftSinceCommit
    ? `**${h.health}%** · ${h.rungLabel} — unchanged since commit`
    : `**${h.health}%** · ${h.rungLabel}`;
  return {
    title: "Thesis health",
    body: `${headline}\n\n${rows || "Pillars not wired on this row."}`,
  };
}

function managementSection(play: TerminalPlay): RichSection {
  const action = swingActionDisplay(play);
  const lines: string[] = [];
  lines.push(`**Recommended:** ${play.recommendation ?? action?.label ?? "HOLD"}`);
  if (play.recNote) lines.push(play.recNote);
  if (play.manageAction) {
    lines.push(`Manage engine: **${play.manageAction}**`);
    // GAP FOUND (2026-09-18, Ask Largo standing mandate): `manage.ts`'s `evaluateSwingManagement`
    // stamps `enforced:true` always for its four capital-preservation GATE rungs, but `false` for
    // an EDGE rung (catalyst_shift/regime_shift/flow_decay/rel_strength_loss/vol_collapse/
    // time_stop/add_eligible) until that specific rung graduates in the calibration ladder
    // (n≥10, delta≥15pt) — and until graduation the ledger itself takes NO action on it
    // (`latchSwingLiveStatus`, manage-sync.ts: only an enforced `profit_ladder` latches TRIM).
    // `manage-sync.ts` persists that flag on every snapshot (`event_json.enforced`) but nothing
    // read it back out — so this exact line above (and the "SELL"/"TRIM"/"BUY" recommendation
    // badge, which `recommendationFromManageAction` derives from the same `manageAction` 1:1)
    // showed an un-graduated advisory signal with IDENTICAL weight to a hard, acted-on gate. A
    // member reading "Manage engine: TAKE_PARTIAL" (or "Recommended: SELL") had no way to tell
    // whether the system itself was about to act on that or was merely tracking unproven
    // evidence — the exact conflation the calibration-first "evidence, not gating, until
    // graduated" law (manage.ts's own header) exists to prevent at the DECISION layer; it was
    // leaking back in at the DISPLAY layer. `manageAction === "HOLD"` is excluded — a HOLD is
    // never a recommendation to act on, so there is nothing to qualify. `manageEnforced` is
    // tri-state (true/false/null) and this only fires on an explicit `false`, never on null
    // (no snapshot yet — honest silence, not a fabricated advisory label).
    if (play.manageAction !== "HOLD" && play.manageEnforced === false) {
      lines.push(
        "_Advisory only — this signal hasn't graduated to an enforced recommendation yet; the system itself is not acting on it, the position stays as-is until it does._",
      );
    }
  }
  if (play.exitPolicy) {
    const ep = play.exitPolicy;
    const trims = ep.trim_levels
      .map((t) => `+${t.trigger_pct}%${t.fired ? " ✓" : ""}`)
      .join(" · ");
    if (trims) lines.push(`Trim ladder: ${trims}`);
    if (ep.stop_premium != null || ep.target_premium != null) {
      // BUG FIX (Ask Largo standing mandate, 2026-10-08, live repro EXTR OPEN brief): once a
      // trim rung priced at/above `target_premium` has already fired, this line still printed
      // the bare, un-annotated "target $X" — on the SAME single-rung swing exit policy
      // (SWING_SCALE_OUT_POLICY: one rung at +100%, target_pct also 100, so the fired trim's
      // `premium` and `target_premium` are the literal same dollar level — see
      // play-brief-intel.ts's symmetric 2026-09-22 fix for this exact shape), the member reads
      // "Trim ladder: +100% ✓" one line above "Rails: ... target $0.30" with nothing telling
      // them the target in that second line is the SAME level the checkmark above already says
      // fired — it reads as a fresh, unmet objective directly beside its own "already done"
      // disclosure. play-brief-intel.ts's "What to watch" section already fixed this exact
      // self-contradiction for its own "Premium target rail" line (omitting the room% once
      // fired) but this earlier, more prominent Management-section summary line was never
      // given the equivalent treatment — confirmed by grep, it is the only other call site
      // that renders `target_premium` as a bare value. Mirror the ladder's own "✓" convention
      // (already used two words to the left on the same line, for the identical fact) rather
      // than inventing new wording or suppressing the real number.
      const targetAlreadyFired =
        ep.target_premium != null &&
        ep.trim_levels.some((t) => t.fired === true && t.premium != null && t.premium >= ep.target_premium!);
      const targetLabel = targetAlreadyFired
        ? `${fmtUsd(ep.target_premium)} ✓ (reached)`
        : fmtUsd(ep.target_premium);
      lines.push(`Rails: stop ${fmtUsd(ep.stop_premium)} · target ${targetLabel}`);
    }
  }
  if (play.progress != null && Number.isFinite(play.progress)) {
    lines.push(`Trim progress: **${Math.round(play.progress * 100)}%**`);
  }
  // GAP FOUND (2026-09-18, Ask Largo standing mandate): `play.rollCandidate` (manage.ts's
  // dte_migration/roll_intent, threaded through live-plays.ts -> adapters.ts) is a real, live,
  // per-tick signal — theta decaying faster than thesis progress inside the lane's migration DTE
  // window, the SAME check `roll.ts`'s live executor uses before it actually rolls a position —
  // but it never reached this brief. A member watching a position tick toward its migration
  // window (still HOLD, hasn't hit the harder expiry_risk gate yet) got no warning that a roll was
  // already being weighed on every refresh; the first they'd hear of it was after the fact, via
  // the roll-history disclosure (play-brief-narrative.ts's rollLine, which only ever cites PAST
  // rolls). Only ever shown when a real candidate exists right now (never a fabricated "no roll
  // pending" line, matching this section's own honest-absence convention elsewhere).
  if (play.rollCandidate) {
    lines.push(`Roll watch: **theta outpacing thesis** — ${play.rollCandidate.reason}.`);
  }
  // GAP FOUND (2026-09-18, Ask Largo standing mandate): `play.underlyingExcursion` (manage-sync.ts's
  // `signedExcursionPct` — the UNDERLYING's own signed favorable/adverse move since entry, computed
  // and persisted every management tick) is a distinct read from the OPTION premium peak/P&L this
  // section already shows above: a position can sit on modest premium P&L while the underlying
  // quietly ran hard favorable and gave most of it back (or the reverse, under IV effects). Pinned
  // to `swing_position_snapshots.running_mfe`/`.running_mae` on every tick and never read back out
  // of it anywhere in the serving/brief layer until now — same shape as `entryPresentPillars`/
  // `archetypeNearTie`/`topFlowProvenance` above. Only rendered once both extremes are known (never
  // a fabricated 0% when the underlying excursion isn't yet computable).
  if (play.underlyingExcursion) {
    const { mfePct, maePct } = play.underlyingExcursion;
    lines.push(
      `Underlying excursion since entry: **${fmtPct(mfePct)} favorable** / **${fmtPct(maePct)} adverse**.`,
    );
  }
  return { title: "Management", body: lines.join("\n\n") };
}

/**
 * BUG FIXED 2026-09-11 (Ask Largo standing mandate, post-trim state consistency check): once a
 * swing's exit-ladder trim has FIRED (peak reached the +100% rung, half the position mechanically
 * banked per SWING_SCALE_OUT_POLICY), `play.pnlPct` is `mark/entry - 1` — the UNREALIZED return on
 * the remaining runner ONLY (live-plays.ts's `livePnlPct`). The Position section printed that raw
 * number as if it were the whole position's P&L, which massively UNDERSTATES the true outcome: a
 * live CRWD brief (position #19, entry $16.65, peak $38.25 = +129.7%, trim fired at +100%, mark
 * back down to $17.05) showed "P&L: +2.4%" when the true blended return — 50% banked at the
 * +100% trigger + 50% still open at +2.4% — is ~+51.2%, not +2.4%. A member reading only this
 * card would believe the position is nearly flat when it has already locked in a large real gain.
 *
 * Fix: compute a BLENDED P&L (fired tranches at their trigger_pct + the untouched runner fraction
 * at the live mark) alongside the existing runner-only line, rather than replacing it — the raw
 * `P&L:` line is still meaningful as "how is the open remainder doing", it was just being read as
 * "how is the position doing" with nothing to correct that impression once a trim had fired.
 *
 * `trigger_pct` (not a reconstructed fill price) is the correct banked-gain proxy here: it is the
 * exact mechanical level `buildTerminalExitLadder` arms `fired` against (see terminal-ladder.ts's
 * own comment: "premium is the ABSOLUTE per-contract level... the tranche banks at"), the same
 * convention the 0DTE lane's `trimScaleBlendedPnlAtStop` already uses for its own as-managed blend
 * (marks-math.ts) — this brings swing's live brief in line with that existing precedent instead of
 * inventing a new convention.
 */
function blendedPnlPct(play: TerminalPlay): number | null {
  const ep = play.exitPolicy;
  if (!ep || play.pnlPct == null || !Number.isFinite(play.pnlPct)) return null;
  const firedFraction = ep.trim_levels.reduce((sum, t) => sum + (t.fired ? t.fraction : 0), 0);
  if (firedFraction <= 0) return null; // nothing banked yet — the runner-only line already IS the whole position
  const bankedPnl = ep.trim_levels.reduce(
    (sum, t) => sum + (t.fired ? t.fraction * t.trigger_pct : 0),
    0,
  );
  const runnerFraction = Math.max(0, 1 - firedFraction);
  return bankedPnl + runnerFraction * play.pnlPct;
}

/**
 * BUG FOUND 2026-09-11 (Ask Largo standing mandate — multi-position-same-ticker identity check).
 * `HorizonPlay.positionId` is explicitly documented ("disambiguates ticker collisions in briefs")
 * but `horizonPlayFromBangerPosition` (banger-lane-merge.ts) never stamps it, even though the
 * source `BangerPositionRow` carries a real `id`. Live repro 2026-09-11: APPS, BAND, INSP and TWST
 * each had TWO concurrent, genuinely independent open Banger-engine positions on the same ticker
 * at once (different strikes/expiries/entry dates/P&L — e.g. APPS 12C entered 09-08 at +28.4% vs
 * APPS 13C entered 09-10 at ~0%). A ticker-only play-brief request (no strike/right hint — exactly
 * how Largo's tool-call convention and a plain "how's my APPS position doing" resolve) silently
 * picked ONE via `pickLanePlayForBrief`'s best-live-P&L tiebreak and composed a full brief for it
 * with ZERO indication a second concurrent position on the same underlying existed. This is Largo
 * contract C4 territory (identity) from the other direction: the identity shown was correct for
 * the one row chosen, but a second real position was silently omitted rather than disclosed — the
 * same "absence must be disclosed, never silent" principle (C3) applied to a sibling position
 * instead of a missing field.
 *
 * Fix scope: this does NOT attempt to make `positionId` resolvable for banger rows (that would
 * require wiring an entirely separate resolution branch against `banger_positions` in
 * `resolveSwingPlayForBrief`, and risks a WORSE bug — banger row ids and swing ledger row ids are
 * separate DB sequences that can collide, so blindly trusting a banger id as a swing positionId
 * hint could resolve to a completely unrelated swing position). Instead: a purely additive
 * disclosure, using data already on `ctx.laneRows` (no new fetch), naming every OTHER live position
 * on the same ticker by its distinguishing contract + entry so nothing is hidden.
 *
 * BUG FOUND 2026-10-11 (Ask Largo standing mandate — live AMD repro, positionId 51 vs 52). This
 * function's self-exclusion used to rely ENTIRELY on `entryPremium` proximity (`> 0.005` away from
 * `play.entry` = "a real sibling", otherwise assumed to be "me") — the doc text above used to
 * justify this as "two genuinely different positions on one ticker always differ in strike/expiry/
 * entry price in practice." Live data falsifies that assumption directly: AMD carried two
 * independently-committed positions (#51 EVENT_DRIVEN, #52 PULLBACK_CONTINUATION — different
 * archetypes, so `commit.ts`'s own idempotency key correctly treats them as separate theses, see
 * `swingThesisKey`) that both resolved to the IDENTICAL contract (605C 2026-10-16) via
 * `pickChainContract`, entered ~3h apart at entry premiums only $0.25 apart. That case happened to
 * clear the `> 0.005` bar, but nothing stops two independently-committed positions from filling at
 * premiums within a half-cent of each other (two orders hitting the same quoted mid) — in that
 * narrower case the old filter would have wrongly treated the real sibling as "self" and silently
 * dropped it, so a member with two live positions on a ticker could see NO disclosure at all
 * (`!siblings.length` returns `null`) — the exact "absence must be disclosed, never silent"
 * violation (C3) this section exists to prevent, just reached via a different gap than the one the
 * comment above already names.
 *
 * Fix: prefer an exact `positionId` match as the self-test whenever both sides carry one (the
 * CommandDeck row-identity convention stamps `id: "SWING:<TICKER>:<positionId>"` for any row with a
 * real ledger position — `parseSwingPlayId` already recovers it elsewhere in this file, e.g. the
 * `bookContextSection` overlap call below). This is a strictly more precise self-test than premium
 * proximity and costs nothing when it's available. Only fall back to the premium heuristic when
 * either side lacks a resolvable `positionId` — unchanged from before, and the one case this still
 * can't disambiguate is itself the subject of the comment above (banger rows never carry one).
 *
 * BUG FOUND (Ask Largo standing mandate, 2026-10-15 — same deep-dive that found #6023's
 * `ownContractExpiry` gap, same root cause, a second independent call site). The early
 * `play.entry == null` return above made this disclosure structurally unreachable for every WATCH
 * candidate: `TerminalPlay.entry` is pnl-anchor-only, populated starting at commit, so it is ALWAYS
 * null pre-entry. That silently hid a real, live, same-ticker sibling position from a member
 * deciding whether to open a NEW position on a ticker they already hold — arguably more actionable
 * than the already-committed case this function was built for. The guard is also unnecessary for
 * correctness: a WATCH row is never itself committed, so it can never appear in `ctx.laneRows` with
 * `liveStatus` set — there is no "self" for the entry-premium proximity test to accidentally
 * exclude, so a same-ticker + `liveStatus` match alone is already a safe, genuine sibling test. Fix:
 * only apply the positionId/premium self-test when THIS play actually has an entry premium to test
 * against (i.e. it is itself a live/committed row that could appear in laneRows); a pre-entry WATCH
 * play skips straight to "every live same-ticker row is a genuine sibling". This function-level fix
 * is necessary but NOT sufficient on its own — `composeSwingPlayBrief`'s `bucket === "watch"` branch
 * never called this function at all (only the `bucket === "open"` branch did), so the call site
 * itself needed the same fix; see that branch below.
 */
function siblingPositionsNote(ctx: SwingPlayBriefContext): RichSection | null {
  const { play } = ctx;
  const ticker = play.ticker.toUpperCase();
  const hasOwnEntry = play.entry != null && Number.isFinite(play.entry);
  const { positionId: selfPositionId } = parseSwingPlayId(play.id);
  const siblings = ctx.laneRows.filter((r) => {
    if (r.ticker.toUpperCase() !== ticker) return false;
    if (!r.liveStatus) return false; // only OTHER live/committed positions matter here
    if (r.entryPremium == null || !Number.isFinite(r.entryPremium)) return false;
    if (selfPositionId != null && r.positionId != null) {
      return r.positionId !== selfPositionId;
    }
    if (!hasOwnEntry) return true; // pre-entry WATCH row: self can't be in laneRows, nothing to exclude
    return Math.abs(r.entryPremium - play.entry!) > 0.005;
  });
  if (!siblings.length) return null;
  const lines = siblings.map((r) => {
    const strike = r.contract?.strike;
    const right = r.contract?.right ?? "C";
    const expiry = r.contract?.expiry ?? "—";
    const entered = r.committedAt ? etStampFromIso(r.committedAt) : null;
    const pnl = r.livePnlPct != null ? fmtPct(r.livePnlPct) : "—";
    return `• **${strike ?? "?"}${right} ${expiry}** — entered ${entered ?? "unknown date"}, entry ${fmtUsd(r.entryPremium ?? null)}, P&L ${pnl}`;
  });
  // BUG FIX (2026-10-21, Ask Largo standing mandate, live repro TSLA WATCH SHORT): the count below
  // used to be `siblings.length + 1` unconditionally, counting THIS brief's own subject play as a
  // "live position" even for a WATCH candidate — which, per this function's own 2026-10-15 fix
  // comment above, is never itself committed and can never appear in laneRows. That overstated real
  // capital-at-risk exposure: a WATCH-bucket brief with exactly 1 real committed sibling rendered
  // "2 concurrent live positions" when there was only the 1 real one. Only count the subject itself
  // when it actually has an entry premium (i.e. is itself live/committed) — `hasOwnEntry` already
  // distinguishes this a few lines up.
  const total = siblings.length + (hasOwnEntry ? 1 : 0);
  return {
    title: "Other concurrent position(s)",
    body: `${ticker} carries ${total} concurrent live position(s) — this brief covers one. Other(s):\n\n${lines.join("\n")}\n\nPass a specific strike/expiry to review a different one.`,
    bias: "neutral",
  };
}

function pnlSection(play: TerminalPlay, readMs: number): RichSection {
  const blended = blendedPnlPct(play);
  // Bug found 2026-09-11 (Ask Largo standing mandate — swing/Largo ownership lane): for a
  // banger-lane position with no live-synced quote yet, `horizonPlayFromBangerPosition`
  // (banger-lane-merge.ts) computes `contract.mid = row.last_mark ?? entry_premium` — a
  // deliberate numeric fallback so downstream ranking/exit-ladder math always has *a* number
  // to work with. That `mid` becomes `play.mark` verbatim (adapters.ts). The rest of this
  // brief already knows the mark is unsynced (`play.markIsSync === true`) and discloses it
  // honestly in two places — `collectOptionMarkStalenessAbsence` puts "option mark: sync quote
  // without freshness timestamp" in `unavailableSources`, and `dataFreshnessSection` prints
  // "Mark age unknown — sync quote without timestamp; treat P&L as indicative" — but THIS line
  // (the actual "Mark: $X" the member reads first, right next to Entry) printed the raw fallback
  // number with no caveat at all. Live repro 2026-09-11: SWING:IMPP/EBS/QCML (open, OPEN status,
  // no positionId — Engine-B/banger ledger rows) all rendered "Entry: $0.10 / Mark: $0.10 /
  // P&L: —" — Entry and Mark byte-identical because Mark IS just Entry replayed, not because the
  // position happens to be exactly flat. A member skimming this line alone has no way to tell
  // "flat" from "we don't actually know" — the one place in the brief that most directly invites
  // that misread was the one place not using the `markIsSync` flag every other section already
  // reads. Fix: same guard `playExpectsLiveOptionMark(play.status) && play.markIsSync`, applied
  // here too — swap the numeric Mark for an honest "unknown (sync quote, no live price yet)"
  // rather than a specific dollar value. WATCH rows are correctly exempt (static chain mid is
  // the intended value there, not a fallback — see `playExpectsLiveOptionMark`'s own comment).
  const markUnsynced = play.markIsSync === true && playExpectsLiveOptionMark(play.status);
  // Bug found 2026-09-11 (Ask Largo standing mandate, live repro SWING:ALAB): `markIsSync` is set
  // by adapters.ts as bluntly as `src.markAsOf == null` — true whenever there is no stored
  // freshness TIMESTAMP, regardless of whether the mark VALUE itself is real. For banger-lane
  // positions (`horizonPlayFromBangerPosition`, banger-lane-merge.ts) that is every single row:
  // `BangerPositionRow` (positions-db.ts) has no `mark_as_of` column at all, so `markAsOf` is never
  // populated one way or the other — a genuinely fresh, real `last_mark` and a position that has
  // never synced look byte-identical to this flag. The `markUnsynced` branch above (added for a
  // real prior bug — the `mid = mark ?? entry` fallback silently echoing entry as if it were a
  // live quote) printed "Mark: unknown" unconditionally on that flag, which was correct for the
  // TRUE fallback case (mark IS entry, no real quote exists) but wrong for a banger row that DOES
  // have a real, distinct last_mark: live repro showed "Mark: **unknown** _(do not read as
  // flat)_" immediately followed by "P&L: **-35.9%**" a few lines later — a P&L that can only
  // exist because `livePnlPct(entry, mark)` (banger-lane-merge.ts) had a real, non-null mark to
  // divide against. Showing "unknown" while confidently deriving a specific percentage from that
  // same "unknown" value is self-contradicting and strictly worse than the pre-fix state for this
  // lane: a member reads "we don't know the price" one line above a number that says otherwise.
  // Fix: the mark is genuinely unknown only when there is no P&L basis either (pnlPct null, the
  // true entry-fallback signature) — when pnlPct is a real number, the mark behind it is real too,
  // it just lacks a stored timestamp, so show the value with an honest "not timestamped" caveat
  // instead of hiding it. Does not touch the true-fallback case (still "unknown", still tested by
  // the IMPP/EBS/QCML repro test below, which already sets pnlPct: null) or the has-a-real-markAsOf
  // path (untouched, markUnsynced is false there). Delegates to the shared
  // `optionMarkGenuinelyUnknown` (play-brief-absence.ts, extracted 2026-09-12) so the exact same
  // "true entry-fallback" test is available to other sections instead of being re-derived (and
  // risking drift) a second time — see that function's own comment for the EBS repro that made a
  // second call site necessary.
  const markGenuinelyUnknown = optionMarkGenuinelyUnknown(play);
  // BUG FIX (2026-10-16, Ask Largo standing mandate — live GOOG/KMPR repro, Bug 1 of the
  // standing "Ask Largo x Night Hawk Swings" ownership mandate; SUPERSEDES the 2026-10-09
  // SG/CNXC and 2026-10-15 ENOV guards this comment used to describe — kept only in git history,
  // not reproduced here, to avoid describing logic that no longer exists).
  //
  // The retired approach redisplayed `P&L:` from `Math.round(play.mark * 100) / 100` — the
  // cent-rounded Mark — reasoning that a member's hand-check against the two displayed dollar
  // figures should always reconcile with the displayed percentage. Two live repros proved that
  // recompute can disagree with the single CANONICAL `pnlPct` every other surface already
  // agrees on (the horizons board's own `livePnlPct`, PlayTerminal.tsx's Command Deck card, and
  // every OTHER section of this same brief — play-brief-narrative.ts's "Round-tripped past
  // breakeven"/"Gave back X% of peak" lines read `play.pnlPct` directly, never a recompute):
  //   1. GOOG (positionId 59): entry $14.875, mark $15.075 — entry itself carries sub-cent
  //      precision the recompute never rounds, so `(round(mark*100)/100) / RAW entry` can
  //      straddle a 1-decimal display-rounding boundary even when the underlying drift is tiny
  //      (0.03pp here): displayed "+1.4%" vs `GET /api/market/nighthawk/horizons?view=swings`'
  //      canonical "+1.3%" for the IDENTICAL position at the IDENTICAL instant.
  //   2. KMPR (positionId 1634): entry $0.05, mark $0.025 — `Math.round(2.5)` rounds UP (JS
  //      half-up rounds ties away from zero) to $0.03, and because KMPR's mark happens to sit
  //      EXACTLY at its own recorded trough (-50.0%), the resulting recompute (-40.0%) lands
  //      safely INSIDE the [trough, peak] bounds the retired guard checked — a full 10-POINT
  //      overstatement of how far a real loser has "recovered" that a bounds-only guard is
  //      structurally unable to catch, because the error never escapes the position's own
  //      recorded range, it just lies within it.
  // Both are instances of the same root problem the prior guards never fully closed: deriving
  // P&L from an INDEPENDENTLY cent-rounded dollar figure, rather than from the single canonical
  // percentage every other surface reads, can disagree with that canonical value by construction
  // — rounding one operand (the mark) of a ratio and not the other (the entry) does not commute
  // with rounding the ratio itself, and no bound on the recompute's distance from `peak`/`trough`
  // can catch a case where the recompute happens to stay inside an already-wide range.
  //
  // Fix: show the canonical `play.pnlPct` directly — no recompute. This is strictly simpler and
  // removes the whole class of future cent-rounding-drift bugs this file had been accumulating
  // increasingly narrow point-guards for since 2026-10-09, rather than adding a third. It also
  // means every section of the brief (Position here, "Trade manager read", "Thesis health", the
  // diff/snapshot narrative) now reads the exact same number, so this also keeps the 2026-10-09
  // CTVA fix's original intent (one internally-consistent P&L per brief) — just from the
  // opposite direction: by never diverging from canonical, instead of reconciling every section
  // to a recompute that could itself diverge from canonical.
  const pnlForDisplay = play.pnlPct;
  // GUARD #2 (2026-10-15, Ask Largo standing mandate — live ENOV repro, positionId 1739, BANGER-
  // origin TRIM/PARTIAL; kept unchanged by the 2026-10-16 fix above — `pnlForDisplay` is now
  // always the canonical `play.pnlPct`, so this guard's job (protecting against a STALE
  // peak/trough watermark, a different bug than the cent-rounding one the comment above
  // describes) is unaffected). Live repro: ENOV entry $0.05, mark $0.33 (a clean,
  // non-cent-ambiguous value) showed `play.pnlPct` = +560.0% while `play.peak` (adapters.ts's
  // `peakDisplay`, derived from the ledger's own `peak_premium` watermark) read +550.0% — ten
  // points BELOW the P&L it's supposed to bound. Root cause traced
  // to `src/lib/banger/positions-db.ts`'s `updateBangerLiveState`: its SQL ratchets
  // `peak_premium = GREATEST(peak_premium, $3)` and `last_mark = $3` in the SAME statement using
  // the SAME bound parameter, which is provably atomic and self-consistent per write — so this can
  // only mean some tick that advanced `last_mark` to its current value did not, for whatever reason
  // (a question that needs raw production DB access this read-only audit session doesn't have, and
  // is out of scope for this fix per this finding's own write-up), carry that same mark into the
  // peak ratchet. Whatever the upstream trigger, the member-facing contract — the canonical
  // `pnlPct` always lies inside [trough, peak] by construction — must hold for what Largo
  // actually DISPLAYS, independent of whether the upstream ledger watermark has caught up yet.
  // Fix: WIDEN the displayed Peak/Trough to bracket the final displayed P&L — never
  // the reverse (clamping P&L down to a stale Peak would UNDERSTATE the member's real gain, the
  // same mistake this file's other absence/precision guards exist to avoid). This is the identical
  // "widen-only, converge-in-place" discipline `positions-db.ts`'s own entry_premium-bracket fix
  // (PR #6027, `db.ts`'s boot-time backfill UPDATE) already applies to the SAME ratchet pair at the
  // storage layer — applied here at the display layer instead, since the task scope for this fix is
  // this file, not a second, unconfirmed change to the live ledger's write path.
  let peakForDisplay = play.peak;
  let troughForDisplay = play.trough;
  if (pnlForDisplay != null && Number.isFinite(pnlForDisplay)) {
    if (peakForDisplay != null && Number.isFinite(peakForDisplay) && pnlForDisplay > peakForDisplay) {
      peakForDisplay = pnlForDisplay;
    }
    if (troughForDisplay != null && Number.isFinite(troughForDisplay) && pnlForDisplay < troughForDisplay) {
      troughForDisplay = pnlForDisplay;
    }
  }
  const lines = [
    `Entry: **${fmtUsd(play.entry)}**`,
    markGenuinelyUnknown
      ? `Mark: **unknown** _(sync quote, no live price yet — do not read as flat)_`
      : markUnsynced
        ? `Mark: **${fmtUsd(play.mark)}** _(live quote, no freshness timestamp)_`
        : `Mark: **${fmtUsd(play.mark)}**${play.markAsOf ? ` (${etStampFromIso(play.markAsOf)})` : ""}`,
    `P&L: **${fmtPct(pnlForDisplay)}**${blended != null ? " _(open runner only — trim already banked, see below)_" : ""}`,
    // BUG FIX (2026-10-17, Ask Largo x Night Hawk Swings standing mandate — live NVDA:62 repro,
    // board-wide sweep found 9/63 committed positions affected). Before this fix, Peak/Trough
    // rendered `fmtPct(peakForDisplay)`/`fmtPct(troughForDisplay)` unconditionally whenever
    // `play.peak`/`play.trough` were non-null — but a position that has NEVER received a single
    // live-marks tick since commit has its peak/trough watermarks still seeded at the commit-time
    // entry premium (entry===peak===trough), so this rendered a confident "0.0%" indistinguishable
    // from a real, observed flat reading, three lines below the SAME section's own honest
    // "Mark: unknown ... do not read as flat" line. `markGenuinelyUnknown` is already computed
    // above and already gates the Mark line — gate Peak/Trough the identical way, since the
    // underlying signal (no live tick has ever landed on this contract) is the same for all three.
    markGenuinelyUnknown
      ? `Peak: **—** _(no live tick yet)_`
      : `Peak: **${fmtPct(peakForDisplay)}**`,
    // ENHANCEMENT (2026-09-15, Ask Largo standing mandate, live repro SWING:CRWD/positionId 19):
    // `play.trough` (the position's own worst excursion — `troughDisplay`, adapters.ts:475-480,
    // computed symmetrically alongside `peakDisplay` on every TerminalPlay row, condor-aware) was
    // fully computed and threaded but had ZERO consumers anywhere in src/lib/swing/ — this brief
    // showed "Peak: +161.3%" with no way to know the same position was down -57.2% before it
    // worked. Conviction-relevant history a trade manager would cite ("this one tested you early,
    // don't flinch on the next drawdown scare") that the data already supports; mirrors Peak's own
    // render (fmtPct handles null as "—" — same convention, both null together when entry/premium
    // data is missing; the 2026-10-17 fix above now also mirrors Peak's `markGenuinelyUnknown` gate).
    markGenuinelyUnknown
      ? `Trough: **—** _(no live tick yet)_`
      : `Trough: **${fmtPct(troughForDisplay)}**`,
  ];
  // GAP FOUND (2026-09-18, Ask Largo standing mandate): `play.greeks` (DeckGreeks: delta/gamma/
  // theta/vega/iv) is a real, live per-contract read for every open swing position — the active-
  // refresh cron fetches it on every tick (`SwingLiveQuote`, live-plays.ts) and carries it onto the
  // held contract (`contractFromRow`), and `terminalPlayFromHorizon` (adapters.ts) already builds
  // `play.greeks` from it via `greeksFromContract` — that call site's own comment traces this back
  // to FINDINGS 2026-08-06 SEV-3 ("greeks never reached the desk... SWING/LEAPS greek strip could
  // never render anything"), fixed there for the Command Deck's own greek strip (PlayTerminal.tsx).
  // But the play-brief — Ask Largo's own consumer of the exact same TerminalPlay object — never
  // read `play.greeks` anywhere in play-brief*.ts: a member asking Largo "what's my theta decay /
  // delta exposure on this position" got nothing, even though the identical live numbers already
  // render one click away on the deck's own greek strip. Same wiring-gap shape as the #4101
  // `unavailableSources` fix — data computed, even already surfaced on a sibling UI surface, never
  // reached the Largo envelope.
  //
  // `greeksFromContract` already only returns a non-null object when at least one field is real
  // (Object.values(...).some(v => v != null)), the same honesty gate the deck's own `greeksLive`
  // check applies — so `if (play.greeks)` alone is sufficient to decide PRESENCE; no extra absence
  // plumbing to duplicate. Formatting matches PlayTerminal.tsx's `fmtGreek` exactly (signed
  // delta/gamma/vega, unsigned theta since a real theta value already carries its own minus sign,
  // iv as a rounded whole-number percent) so a member cross-referencing the deck and Largo never
  // sees the same number rendered two different ways.
  //
  // BUG FIX (2026-10-18, Ask Largo × Night Hawk Swings mandate): the comment above conflated
  // PRESENCE (is the field non-null) with FRESHNESS (is it current) — `if (play.greeks)` is correct
  // for the former but says nothing about the latter. Greeks/liquidity are read off the identical
  // `play.contract` snapshot the Mark line is computed from (adapters.ts), so every staleness/sync
  // caveat the Mark line already discloses applies equally here, but neither this block nor the
  // Liquidity/Spread block below ever carried one. Live repro: NVDA (positionId 62,
  // markGenuinelyUnknown — never ticked since commit) showed "Mark: unknown (sync quote, no live
  // price yet — do not read as flat)" followed four lines later by a fully confident "Greeks: Δ
  // +0.59" with no caveat, even though delta comes from the exact same never-synced read. TSLA/CRWV
  // (both markAsOf-stamped but optionMarkIsStale) showed the brief's own separate "Data freshness"
  // section independently flag "Option mark stale" while this same section's Greeks/Spread lines
  // stayed fully confident with zero mention it's the identical quote. Disclosing, not suppressing
  // — the entry-time/aged values are still real, useful context (e.g. "what were my greeks when I
  // entered"), so hiding them would be a regression, not a fix. Computed once, shared with the
  // Liquidity/Spread block below — both read the identical contract snapshot.
  const staleCaveat = markGenuinelyUnknown
    ? " _(entry-time read — no live tick since commit, do not read as current)_"
    : markUnsynced
      ? " _(live quote, no freshness timestamp)_"
      : optionMarkIsStale(play, readMs)
        ? " _(stale — same quote Mark flagged above)_"
        : "";
  if (play.greeks) {
    const g = play.greeks;
    const sign = (v: number) => (v >= 0 ? "+" : "");
    const parts: string[] = [];
    if (g.delta != null) parts.push(`Δ ${sign(g.delta)}${g.delta.toFixed(2)}`);
    if (g.gamma != null) parts.push(`Γ ${sign(g.gamma)}${g.gamma.toFixed(2)}`);
    if (g.theta != null) parts.push(`θ ${g.theta.toFixed(2)}/day`);
    if (g.vega != null) parts.push(`ν ${sign(g.vega)}${g.vega.toFixed(2)}`);
    // BUG FOUND (Ask Largo standing mandate, 2026-09-20): `normalizeImpliedVol` (options-snapshot.ts)
    // exists specifically to catch a REAL provider placeholder — some expired/edge-row snapshots
    // return `implied_volatility` on the PERCENT scale (20 = 2000%, 15.83 = 1583%) instead of the
    // normal DECIMAL scale (0.229 = 22.9%) — but that function's own doc comment ("consumers pass
    // it through normalizeImpliedVol()... call this at the point IV is displayed") had ZERO call
    // sites anywhere in the app (repo-wide grep, confirmed before this fix): every consumer of
    // `play.greeks.iv`/`ChainContract.iv` formatted the RAW provider value straight through
    // `Math.round(iv * 100)`. A percent-scale placeholder would have rendered here as "IV 2000%"
    // instead of the intended "IV 20%" — a live-reachable, member-visible defect on any contract
    // Polygon returns that placeholder for (the function's own docstring: "seen on expired/edge
    // rows"). Same shape has the identical unguarded formatter in the Command Deck's own greek
    // strip (`PlayTerminal.tsx`'s `fmtGreek`, fixed in the same PR) — both trace back to the same
    // unguarded `snap.iv` → `ChainContract.iv` → `DeckGreeks.iv` pipe. Guarding only rescales an
    // unmistakable placeholder (>= 500% decimal-equivalent); every real IV reading (including a
    // genuine near-0% one) passes through completely unchanged.
    if (g.iv != null) {
      const iv = normalizeImpliedVol(g.iv);
      if (iv != null) parts.push(`IV ${Math.round(iv * 100)}%`);
    }
    if (parts.length) lines.push(`Greeks: ${parts.join(" · ")}${staleCaveat}`);
  }
  // GAP FOUND (2026-09-18, Ask Largo standing mandate): the deck's own greek strip (fixed above) and
  // contract-ranker.ts's tradability score both already read live bid/ask on the held contract, but
  // no consumer ever told a member what the CURRENT spread costs to trim into — the brief showed P&L
  // and greeks but nothing about execution quality, even though `SWING_SUB_LANES[subLane].liquidity.
  // maxSpreadPct` (taxonomy.ts) is the exact same calibrated entry-time liquidity bar contract-ranker
  // enforced when this contract was PICKED. `liquidityFromContract` (adapters.ts, mirrors
  // `greeksFromContract` above) only returns non-null when a live bid or ask exists; `spreadPct` is
  // additionally null on a one-sided book, so this renders nothing when there's truly no live quote,
  // just bid/ask with no comparison line when spreadPct can't be priced, and the full comparison only
  // when both the live spread AND the sub-lane's own gate are known.
  if (play.liquidity && (play.liquidity.bid != null || play.liquidity.ask != null)) {
    const { bid, ask, spreadPct } = play.liquidity;
    const quote = bid != null && ask != null ? `${fmtUsd(bid)}/${fmtUsd(ask)}` : fmtUsd(bid ?? ask);
    if (spreadPct != null) {
      const gate = SWING_SUB_LANES[play.subLane as SwingSubLane]?.liquidity.maxSpreadPct ?? null;
      const spreadLine = `Spread: **${(spreadPct * 100).toFixed(1)}%** (${quote})`;
      lines.push(
        (gate != null
          ? `${spreadLine} — this sub-lane's own entry liquidity bar was **${(gate * 100).toFixed(0)}%**, so current execution is ${spreadPct <= gate ? "still inside" : "now wider than"} it.`
          : spreadLine) + staleCaveat,
      );
    } else {
      lines.push(`Quote: **${quote}**${staleCaveat} _(one-sided book — spread not priceable)_`);
    }
  }
  if (blended != null) {
    lines.push(`Blended P&L (realized trim + open runner): **${fmtPct(blended)}**`);
    // The blended composite above is otherwise opaque arithmetic a member has to trust —
    // name the fired rung(s) that produced it (fraction @ trigger, plus the ladder's own
    // frozen absolute premium level when one was priced) so the number is self-verifying
    // instead of a black box. `premium` is null only when the row had no entry basis to
    // price the level off (terminal-ladder.ts) — never fabricate one in that case.
    const banked = (play.exitPolicy?.trim_levels ?? []).filter((t) => t.fired);
    if (banked.length) {
      const parts = banked.map((t) => {
        const pct = `**${Math.round(t.fraction * 100)}% @ +${t.trigger_pct}%**`;
        return t.premium != null ? `${pct} (${fmtUsd(t.premium)})` : pct;
      });
      lines.push(`Banked: ${parts.join(" · ")}`);
    }
  }
  // BUG FIX (2026-10-17, Ask Largo x Night Hawk Swings standing mandate — live CAVA repro,
  // positionId 1875, one trim already banked at +100%). `execPnlPct` is priced on the exact same
  // open-runner-only basis as `pnlPct` two sections above (`execSlippageCoaching`,
  // play-brief-narrative-coaching.ts, diffs them "mid vs fill" on the identical scope) — the plain
  // P&L line already discloses this with the `blended != null` qualifier below, but Exec P&L
  // rendered with none. By the time a reader reaches Exec P&L, the "Blended P&L"/"Banked" lines
  // just above it have established a whole-position frame, so an unqualified "Exec P&L: +76.8%"
  // reads as "what I'd net exiting my entire remaining position" when it is only the runner leg's
  // own fill-based P&L — the same misread class this file has fixed repeatedly for the plain P&L
  // line (CRWD/NRG/NN 2026-09-10..14), just never reaching this sibling line. Mirror the same
  // qualifier, not a new one, so the two lines read consistently.
  if (play.execPnlPct != null)
    lines.push(
      `Exec P&L: **${fmtPct(play.execPnlPct)}**${blended != null ? " _(open runner only — trim already banked, see above)_" : ""}`,
    );
  if (play.trackPct != null) lines.push(`Since flag: **${fmtPct(play.trackPct)}**`);
  return { title: "Position", body: lines.join("\n") };
}

/** Days between `sinceIso` and `nowMs`, floored, or null when `sinceIso` is missing/unparseable. */
function daysOnWatch(sinceIso: string | null | undefined, nowMs: number): number | null {
  if (!sinceIso) return null;
  const sinceMs = Date.parse(sinceIso);
  if (!Number.isFinite(sinceMs)) return null;
  return Math.max(0, Math.floor((nowMs - sinceMs) / 86_400_000));
}

// BUG FIX (Ask Largo standing mandate, 2026-10-12): `Math.ceil(msLeft / 86_400_000)` rounds ANY
// positive sub-24h remainder up to "1 day" — a deadline 4 hours away and one 23 hours away both
// rendered "1 day left", identical to a deadline genuinely ~1.0 days out. Live repro: MRVL WATCH
// brief, fetched 2026-10-12 05:03 ET, `entryDeadline` 2026-10-12 09:15 ET (same calendar day, ~4h12m
// away) — "Entry window closes ... (1 day left)". A member reading "1 day left" at 5am would
// reasonably plan to act later that day or the next morning; the real window closes before most
// members are even awake. Below 24h, switch to hours (still ceil'd, so "a few minutes left" never
// reads as "0 hours" — same floor-at-1 discipline Math.ceil already gave the day case); at/above 24h,
// keep the existing day-granularity phrasing unchanged (the sibling tests pinning "N days left" for
// multi-day windows still pass byte-for-byte).
function entryWindowTimeLeftLabel(msLeft: number): string {
  const clamped = Math.max(0, msLeft);
  if (clamped < 86_400_000) {
    const hours = Math.max(1, Math.ceil(clamped / 3_600_000));
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  const days = Math.ceil(clamped / 86_400_000);
  return `${days} day${days === 1 ? "" : "s"}`;
}

function watchEntrySection(play: TerminalPlay, readMs: number): RichSection {
  const lines: string[] = [];
  // Computed once, up front: `deadPlayReason` is the authoritative "is this play already dead for
  // ANY reason" check (INVALIDATED, calendar-deadline-expired, contract-expired, or EXTENDED-chase)
  // — already used a few lines below for the gate-block "moot" qualifier. Reused here (BUG FIX, Ask
  // Largo standing mandate, 2026-10-08) to gate the forward-looking "Entry window closes" line too,
  // instead of the narrower `play.watchEntryExpired` flag that only covers the calendar-deadline
  // case. `watchEntryExpired` false does NOT mean the play is still live — an EXTENDED-chase play
  // (setupState "EXTENDED" / entryStatus "EXTENDED_CHASE") leaves it false while still carrying a
  // real future `entryDeadline`, so the old guard let this section say "Entry window closes ... (N
  // days left)" a few lines above — and the brief's own top-level invalidation line say "Extended
  // past the valid entry window — this setup is no longer live" — about the SAME play, in the SAME
  // response. Both lines were independently correct in isolation (two different kinds of "window":
  // calendar-deadline vs. price-extension), but reusing the word "window" for both meanings read as
  // a flat self-contradiction to a member. Live repro: NTAP, 2026-10-08 (Ask Largo health-check
  // deep-dive) — see docs/audit/findings-staging/2026-10-08-swing-watch-entry-window-wording-collision.md.
  const dead = deadPlayReason(play);
  const label =
    swingActionDisplay(play)?.label ??
    play.swingEntryAction?.toUpperCase() ??
    play.recommendation ??
    "WAIT";
  lines.push(`**Entry stance:** ${label}`);
  if (play.servingSection) lines.push(`Serving section: **${play.servingSection.replace(/_/g, " ")}**`);
  if (play.setupState) lines.push(`Setup: **${play.setupState}**`);
  if (play.entryStatus) lines.push(`Entry geometry: **${play.entryStatus}**`);
  // Age-on-watch (FINDINGS-worthy gap, 2026-09-10): `detectedAt` (the "WATCH Published clock",
  // already threaded onto TerminalPlay and rendered on the Command Deck panel) was never read by
  // any NARRATED play-brief section — a member asking Largo directly about a WATCH play got no
  // "how long has this been building" context even though the deck UI shows it elsewhere. A thesis
  // sitting on WATCH for 45+ real days (AMD, confirmed live) read identically in the brief to one
  // flagged an hour ago. `fadeStaleSwingCandidates` means a persistent row is a genuinely
  // re-qualifying signal, not an orphaned one — but "still qualifying" and "still fresh" are
  // different facts, and only the first was ever narrated.
  const days = daysOnWatch(play.detectedAt, readMs);
  if (days != null) {
    // BUG FIX (Ask Largo standing mandate, 2026-10-03): this literally said "still on WATCH"
    // regardless of the play's real serving section — but this section renders for every
    // pre-entry bucket (WATCH, RESEARCH, WAITING_FOR_ENTRY all route through bucket==="watch"),
    // so a RESEARCH or WAITING_FOR_ENTRY play read "Serving section: RESEARCH" one line above
    // "still on WATCH" in the same section — directly self-contradictory. Live repro: ZS,
    // servingSection RESEARCH. Uses the real serving section, falling back to "WATCH" only when
    // it's genuinely absent.
    const sectionLabel = play.servingSection ? play.servingSection.replace(/_/g, " ") : "WATCH";
    lines.push(
      `First flagged **${days} day${days === 1 ? "" : "s"} ago**${play.detectedAt ? ` (${etStampFromIso(play.detectedAt)})` : ""} — still on ${sectionLabel}, not yet graduated to a real position.`,
    );
  }
  // GAP FOUND (2026-09-18, Ask Largo standing mandate): entry-enterability.ts already computes the
  // real entry-validity deadline (entry-model.ts's sub-lane windows, real-NYSE-trading-day aware)
  // to decide the boolean `watchEntryExpired` — but that concrete date was discarded the moment the
  // boolean was derived, so a member watching a still-live setup had no forward-looking runway
  // ("how much longer is this good for") to weigh against `First flagged` above; the first they'd
  // hear about the deadline was the EXPIRED badge itself, after it had already passed. Mirrors the
  // days-on-watch fix directly above it (same section, same "a real computed fact was silently
  // dropped before reaching the model" shape) — forward-looking instead of backward-looking. Only
  // shown while NOT already dead for ANY reason (`dead`, computed at the top of this function —
  // the EXPIRED badge + `deadPlayReason`'s gate-block qualifier below already own every dead case,
  // not just the calendar-deadline one; see that computation's own comment for why `watchEntryExpired`
  // alone used to under-cover this) and only when a real deadline was resolvable (never fabricated).
  if (!dead && play.entryDeadline) {
    const deadlineMs = Date.parse(play.entryDeadline);
    if (Number.isFinite(deadlineMs)) {
      const timeLeft = entryWindowTimeLeftLabel(deadlineMs - readMs);
      lines.push(
        `Entry window closes **${etStampFromIso(play.entryDeadline)}** (**${timeLeft}** left) — stale after that, wait for a fresh setup.`,
      );
    }
  }
  if (play.gateBlocks?.length) {
    // BUG FIX (Ask Largo standing mandate, 2026-09-14): this used to always header the list
    // "Gates blocking entry:", implying clearing them would open entry — false whenever the play
    // is already past its entry deadline or invalidated (entry-enterability.ts's own if-chain
    // checks those BEFORE gate-blocked, so the gate is never actually what's stopping entry in
    // that case; entry-verdict.ts keeps the gate evidence attached anyway rather than dropping
    // it). Live repro: ORCL WATCH brief, "Entry stance: EXPIRED" and "Gates blocking entry:
    // g_s4_regime..." sat in the same section with nothing marking the gate as moot. Same root
    // cause `entryTriggerDeadReason` (play-brief-intel.ts) already fixed for the Entry-trigger
    // line one section down — `deadPlayReason` is the shared check both now use.
    //
    // BUG FIX (Ask Largo standing mandate, 2026-10-08): this used to ALSO render the full
    // `code: reason` list here — but `watchGateCoaching` (play-brief-narrative-coaching.ts),
    // which composeSwingPlayBrief always places immediately after this "Entry" section (inside
    // "Trade manager read") for a WATCH play, independently renders the exact same
    // `play.gateBlocks` codes+reasons in full too. Both are gated on the identical
    // `play.gateBlocks?.length` check with no coordination between the two files — live repro:
    // AMD WATCH brief, 2026-10-08, "## Entry" and "## Trade manager read" both carried the
    // verbatim `entry_window_expired` reason text. This is the exact same duplication shape the
    // 2026-09-12 `watchForSection` fix (below, "Watch levels") already removed from a THIRD
    // location — that fix made "Watch levels" defer to this section ("see Entry section above")
    // on the premise this section was the one true home, but never noticed this section and
    // "Trade manager read" were ALSO duplicating each other the whole time. Resolved the other
    // way around this time: `watchGateCoaching`'s rendering is the richer of the two (it already
    // states "moot" framing identically, and per its own comment was kept as "the single source
    // of truth" on 2026-10-07) and renders for EVERY watch-bucket play unconditionally (see
    // `actionNarrative`'s watch branch, play-brief-narrative.ts), so pointing this section at it
    // — rather than the reverse — loses no information and needs no new plumbing. The
    // "Watch levels" pointer below was repointed at "Trade manager read" too, so there is now
    // exactly one full-text home instead of two independent ones.
    //
    // BUG FIX (Ask Largo standing mandate, 2026-10-18): `dead` (above, `deadPlayReason`) only
    // covers the 4 cases where the play is categorically done — it stayed false for a play held
    // back by the score floor or a still-forming thesis, so THOSE plays got the un-qualified
    // "**Gates blocking entry:**" header, the same false "clearing this opens entry" implication
    // the 2026-09-14 fix above addressed for the other 4 cases. Live repro: CLS WATCH brief
    // (score 59 vs a 60 floor, Legacy-only `signalKinds` auto-stamping the non-blocking
    // `legacy:exempt` tag). `gateFramingMootReason` is `deadPlayReason` plus exactly those two
    // extra cases — see its own doc comment for why they're a separate function rather than two
    // more cases on `deadPlayReason` itself (that function has other callers for which a
    // FORMING/below-floor play must NOT read as dead).
    const gateFramingMoot = gateFramingMootReason(play);
    const gateCount = play.gateBlocks.length;
    lines.push(
      gateFramingMoot
        ? `**Also gate-blocked** (moot — ${gateFramingMoot}) — see Trade manager read below.`
        : `**Gates blocking entry:** ${gateCount} gate${gateCount === 1 ? "" : "s"} — see Trade manager read below.`,
    );
  } else if (play.recommendation === "BUY") {
    lines.push("No mechanical gates blocking entry on this read.");
  }
  return { title: "Entry", body: lines.join("\n\n") };
}

function closedSection(play: TerminalPlay): RichSection {
  const lines = [
    `Exit P&L: **${fmtPct(play.exitPnlPct)}**`,
    play.closedReason ? `Reason: **${play.closedReason}**` : null,
    play.mfeCapturePct != null ? `MFE capture: **${fmtPct(play.mfeCapturePct)}**` : null,
    play.exitAt ? `Closed: **${etStampFromIso(play.exitAt)}**` : null,
  ].filter(Boolean);
  return { title: "Outcome", body: lines.join("\n") };
}

function gexFreshness(gex: GexPositioning | null | undefined, readMs: number): BieFreshness {
  const ageMs = gexMatrixAgeMs(gex, readMs);
  if (ageMs == null) return "unknown";
  // Align with gexMatrixStale — future-skewed asof must not read as "unknown"/fresh (Largo C2).
  if (gexMatrixStale(gex, readMs)) return "stale";
  return freshnessFromAgeMs(ageMs);
}

function fundamentalsFreshness(
  asOf: string | null | undefined,
  readMs: number,
): BieFreshness {
  // Cadence-scaled for short-interest's ~biweekly FINRA settlement cycle, not the generic
  // market-tick 10-minute bucket (see fundamentalsFreshnessTag's doc comment, play-brief-absence.ts).
  return fundamentalsFreshnessTag(asOf, readMs);
}

function vectorFreshness(vec: VectorFullState | null, readMs: number): BieFreshness {
  if (!vec?.asOf) return "unknown";
  return describeVectorFreshness(vec.asOf, readMs).freshness;
}

/** C1: BieLevel provenance must carry ET stamps, not raw UTC ISO — cross-product joins depend on it. */
function levelProvenanceAsOf(
  gex: GexPositioning | null | undefined,
  vec: VectorFullState | null,
  prefer: "gex" | "vector",
): string | null {
  if (prefer === "gex") {
    return gex?.as_of_et ?? etStampFromIso(gex?.asof) ?? vec?.asOfEt ?? etStampFromIso(vec?.asOf) ?? null;
  }
  return vec?.asOfEt ?? etStampFromIso(vec?.asOf) ?? gex?.as_of_et ?? etStampFromIso(gex?.asof) ?? null;
}

/**
 * `confluence (kind1+kind2)` label for the structured `levels` array below. The actual price-
 * disambiguation logic (BUG FIX 2026-09-13, live repro NRG/MU/SKHY) now lives in the shared
 * `confluenceZoneKindsLabel` (play-brief-absence.ts) — extracted 2026-09-14 once two sibling
 * prose call sites (play-brief-intel.ts, play-brief-narrative-coaching.ts) turned up with the
 * exact same unpatched bug; see that function's own doc comment for the full history. This
 * wrapper only adds the `confluence (...)` framing this file's structured levels array expects.
 */
function confluenceZoneLabel(
  z: ConfluenceZone,
  primary: { callWall?: number | null; putWall?: number | null },
): string {
  return `confluence (${confluenceZoneKindsLabel(z, primary)})`;
}

function levelsFromContext(
  ctx: SwingPlayBriefContext,
  readMs: number,
  bucket: "watch" | "open" | "closed",
): BieLevel[] {
  const levels: BieLevel[] = [];
  // BUG FIX (Ask Largo standing mandate, 2026-10-07): "Watch levels" (watchForSection,
  // play-brief-intel.ts) narrates `play.flagUnderlyingPx`/`play.entryTriggerUnderlyingPx` in prose
  // ("Flag anchor: 411.79 — track move from here", "Entry trigger: 411.04 — ... this is what
  // actually fires the setup") for every WATCH-bucket play, but neither ever reached this
  // structured `levels` array — the exact same gap already found and fixed for the Vector gamma
  // magnet (see that fix's comment a few lines below). Unlike the gamma magnet, these two levels
  // do NOT depend on Vector/GEX at all (they come straight off the swing gate's own commit
  // context), so they are the one pair of levels a "show on chart" follow-up or another Largo
  // consumer could ALWAYS get structurally for a pre-entry setup — and the one case this bites
  // hardest is exactly when Vector/GEX ARE cold/stale (confirmed live, WDC 2026-10-07: GEX
  // positioning + Vector desk state both unavailable that cycle), which left `envelope.levels`
  // completely empty even though the setup's own trigger geometry was fully known. Scoped to the
  // WATCH bucket only, mirroring where watchForSection itself renders these — an OPEN/CLOSED play
  // has already crossed (or never needs) this geometry, so surfacing it there would be stale noise
  // the prose doesn't show either.
  if (bucket === "watch") {
    const play = ctx.play;
    // BUG FIX (Ask Largo standing mandate, 2026-10-07 — same cycle as the fix above, found
    // auditing its own output): both levels below were stamped `asOf: ctx.asOf` (today's scan
    // timestamp) with a hardcoded `freshness: "recent"`, even though the note on the very same
    // level says "pinned when first flagged" — i.e. the PRICE is `play.detectedAt`-old, not
    // scan-fresh. Live repro, same WDC play the fix above was built from (detectedAt
    // 2026-10-06T16:07:50Z, ~23h before this scan): the narrated "Watch levels" section is
    // consistent ("First flagged 1 day ago" renders in the adjacent Entry section off the same
    // `detectedAt`), but the STRUCTURED envelope.levels entry for the identical number claimed
    // `asOf: "<today>"`/`freshness: "recent"` — a direct narrative-vs-structured-envelope
    // contradiction any API consumer reading only `envelope.levels` (not the prose) would get
    // wrong, and the exact "dead-wired data" shape the standing mandate's Largo deep-dive checks
    // for. A flag pinned 45+ real days ago (the AMD repro the age-on-watch fix above cites) would
    // have read `freshness: "recent"` forever. Anchored to `play.detectedAt` (the same "WATCH
    // Published clock" the narrative age line already trusts) with `freshnessFromObservedMs`
    // doing real age-based classification — same precedent as `archetypeTrackRecordSection`'s
    // `asOf: etStampFromIso(...) ?? ctx.asOf` / `freshness: Number.isFinite(...) ? ... : "unknown"`
    // fallback a few hundred lines below. Falls back to `ctx.asOf`/"unknown" only when
    // `detectedAt` itself is absent, never silently reusing the old wrong-but-present value.
    const pinnedMs = play.detectedAt ? Date.parse(play.detectedAt) : NaN;
    const pinnedProvenance = {
      source: "Swing lane",
      asOf: (play.detectedAt ? etStampFromIso(play.detectedAt) : null) ?? ctx.asOf,
      freshness: Number.isFinite(pinnedMs) ? freshnessFromObservedMs(pinnedMs, readMs) : ("unknown" as const),
    };
    if (play.flagUnderlyingPx != null && Number.isFinite(play.flagUnderlyingPx)) {
      levels.push({
        label: "flag anchor",
        price: play.flagUnderlyingPx,
        note: "pinned when first flagged — track move from here",
        provenance: pinnedProvenance,
      });
    }
    if (play.entryTriggerUnderlyingPx != null && Number.isFinite(play.entryTriggerUnderlyingPx)) {
      const deadReason = entryTriggerDeadReason(play);
      const verb = play.direction === "SHORT" ? "break/reclaim below fires entry" : "break/reclaim above fires entry";
      levels.push({
        label: "entry trigger",
        price: play.entryTriggerUnderlyingPx,
        note: deadReason ?? verb,
        provenance: pinnedProvenance,
      });
    }
  }
  // Cast to include VectorFreshnessBlock's `market_session_note` (PR #5306, vector-state-
  // freshness.ts) — same cast `evidenceFromContext` already applies to its own `vec`, see that
  // function's comment for why the declared `VectorFullState` type predates this runtime field.
  const vec = (ctx.vector ?? ctx.ecosystem?.vector_full_state ?? null) as
    | (VectorFullState & Partial<VectorFreshnessBlock>)
    | null;
  const gex = ctx.ecosystem?.gex_positioning;
  const vecFresh = vectorFreshness(vec, readMs);
  const gexFresh = gexFreshness(gex, readMs);
  const gexStale = gexMatrixStale(gex, readMs);
  const vectorStale = vectorSnapshotStale(vec, readMs, ctx.sessionDate);
  // BUG FIX (Largo Product Contract C2, 2026-10-16, Ask Largo standing mandate — live TSM/BBWI
  // repro): every level below stamped `freshness: vecFresh`/`gexFresh` even in the exact
  // after-hours scenario `gexMarketSessionNote`/`vec.market_session_note` already exist to catch
  // — a matrix recomputed moments ago off a CLOSED market's last-session tape reads "live" with
  // no caveat anywhere a consumer of the STRUCTURED `levels[]`/`provenance` fields (as opposed to
  // the free-text evidence fact below, which already narrates this) would ever see it. Computed
  // once here, same gating as `vecFresh`/`gexFresh`'s own stale checks (`gexMarketSessionNote`
  // already returns null once `gexMatrixStale` is true, same as `vectorStale` below gates the
  // Vector side), and threaded onto every GEX/Vector-sourced `provenance` alongside — never
  // instead of — `freshness`, per `BieProvenance.market_session_note`'s own doc comment (ADDITIVE,
  // not a new freshness value).
  const vecSessionNote = vectorStale ? null : (vec?.market_session_note ?? null);
  const gexSessionNote = gexMarketSessionNote(gex, readMs);
  // Null at the SOURCE when Vector is stale (not a separate suppression flag) so a live GEX
  // value for the same level still falls through via `??` instead of the whole entry being
  // dropped just because the Vector side happened to be present-but-stale.
  const vecCallWall = vectorStale ? undefined : vec?.gexWalls?.callWalls?.[0]?.strike;
  const vecPutWall = vectorStale ? undefined : vec?.gexWalls?.putWalls?.[0]?.strike;
  const vecFlip = vectorStale ? undefined : vec?.gammaFlip;
  const callWall = vecCallWall ?? gex?.call_wall;
  const putWall = vecPutWall ?? gex?.put_wall;
  const flip = vecFlip ?? gex?.flip;
  const callWallFromStaleGex = vecCallWall == null && gex?.call_wall != null && gexStale;
  const putWallFromStaleGex = vecPutWall == null && gex?.put_wall != null && gexStale;
  const flipFromStaleGex = vecFlip == null && gex?.flip != null && gexStale;
  // Largo C8 (2026-09-15, Ask Largo standing mandate): `price` above already prefers the live
  // Vector wall (`vecCallWall ?? gex?.call_wall`), but this asOf/freshness ternary tested
  // `gex?.call_wall != null` — whether GEX *has* a value at all, not whether GEX was the one
  // `??` actually fell through to for `price`. Since both feeds usually carry a wall, this always
  // picked GEX's (often staler) timestamp/freshness bucket even when the displayed price was
  // Vector's live one — the exact "asOf describes a different read than the one shown" defect,
  // mislabeling a live number as merely "recent". Fixed to test the same vec-side variable that
  // drives `price`'s own precedence, mirroring the `spot` entry below (`vecSpot != null ? ...`).
  if (callWall != null && !callWallFromStaleGex) {
    levels.push({
      label: "call wall",
      price: callWall,
      provenance: {
        source: "GEX",
        asOf: levelProvenanceAsOf(gex, vec, vecCallWall != null ? "vector" : "gex"),
        freshness: vecCallWall != null ? vecFresh : gexFresh,
        market_session_note: vecCallWall != null ? vecSessionNote : gexSessionNote,
      },
    });
  }
  if (putWall != null && !putWallFromStaleGex) {
    levels.push({
      label: "put wall",
      price: putWall,
      provenance: {
        source: "GEX",
        asOf: levelProvenanceAsOf(gex, vec, vecPutWall != null ? "vector" : "gex"),
        freshness: vecPutWall != null ? vecFresh : gexFresh,
        market_session_note: vecPutWall != null ? vecSessionNote : gexSessionNote,
      },
    });
  }
  if (flip != null && !flipFromStaleGex) {
    levels.push({
      label: "gamma flip",
      price: flip,
      provenance: {
        source: "GEX",
        asOf: levelProvenanceAsOf(gex, vec, vecFlip != null ? "vector" : "gex"),
        freshness: vecFlip != null ? vecFresh : gexFresh,
        market_session_note: vecFlip != null ? vecSessionNote : gexSessionNote,
      },
    });
  }
  const vecSpot = vectorStale ? undefined : vec?.spot;
  const spot = vecSpot ?? (gexStale ? undefined : gex?.spot);
  if (spot != null) {
    levels.push({
      label: "spot",
      price: spot,
      provenance: {
        source: vecSpot != null ? "Vector" : "GEX",
        asOf: levelProvenanceAsOf(gex, vec, vecSpot != null ? "vector" : "gex"),
        freshness: vecSpot != null ? vecFresh : gexFresh,
        market_session_note: vecSpot != null ? vecSessionNote : gexSessionNote,
      },
    });
  }
  if (!vectorStale) {
    for (const z of vec?.confluenceZones ?? []) {
      // BUG FIX (Ask Largo standing mandate, 2026-10-20): `z.center` is a weighted average
      // (vector-confluence.ts's `weightedPrice / centerWeightSum`) and routinely carries a long
      // floating-point tail (e.g. 7499.390909090909) — the exact "round at the data layer"
      // systemic issue this file's own CLAUDE.md names. Every other sibling read of this same
      // `ConfluenceZone.center` field rounds it (play-brief-intel.ts's `fmtPriceLevel(z.center)`,
      // play-brief-narrative-coaching.ts's `fmtPriceLevel(top.center)`) — this was the one
      // omission. Rounding here, at the source, means this level is correct on its own rather
      // than depending on route.ts's external roundFloats() wrapper two layers away.
      levels.push({
        label: confluenceZoneLabel(z, { callWall, putWall }),
        price: Math.round(z.center * 100) / 100,
        provenance: {
          source: "Vector",
          asOf: levelProvenanceAsOf(gex, vec, "vector"),
          freshness: vecFresh,
          market_session_note: vecSessionNote,
        },
      });
    }
    // BUG FIX (2026-10-06, Ask Largo standing mandate): this used to stamp the WHOLE Vector
    // state's asOf/freshness onto a dark-pool level regardless of its OWN cache age — the dark-
    // pool cache is warmed on a looser ~10min/25min-TTL cadence than the rest of Vector, so a
    // state computed live seconds ago can still carry a dark-pool read up to 20+ min old with no
    // way to tell from `vecFresh`. See vector-absent-sections.ts's `dark_pool_stale`. Omit rather
    // than fabricate freshness — same discipline collectFocalLevels/catalystsSection now apply.
    if (!darkPoolStale(vec)) {
      for (const dp of vec?.darkPoolLevels ?? []) {
        levels.push({
          label: "dark pool",
          price: dp.strike,
          provenance: {
            source: "Vector",
            asOf: levelProvenanceAsOf(gex, vec, "vector"),
            freshness: vecFresh,
            market_session_note: vecSessionNote,
          },
        });
      }
    }
    // The gamma magnet is narrated prominently in the "Trade manager read" section
    // (magnetCoaching, play-brief-narrative-coaching.ts) as a decision-relevant price ("pull up
    // toward this node"), but was never added to the structured envelope.levels array — anything
    // consuming levels (a "show on chart" follow-up, another Largo surface) had no way to see it.
    if (vec?.magnet?.strike != null) {
      levels.push({
        label: "gamma magnet",
        price: vec.magnet.strike,
        provenance: {
          source: "Vector",
          asOf: levelProvenanceAsOf(gex, vec, "vector"),
          freshness: vecFresh,
          market_session_note: vecSessionNote,
        },
      });
    }
  }
  const vecKing = vectorStale ? undefined : vec?.ladder?.rows?.find((r) => r.isKing)?.strike;
  const king = vecKing ?? gex?.gex_king_strike;
  const kingFromStaleGex = vecKing == null && gex?.gex_king_strike != null && gexStale;
  if (king != null && !kingFromStaleGex) {
    levels.push({
      label: "GEX king",
      price: king,
      provenance: {
        source: "GEX",
        // Largo C8 fix (2026-09-15) — same vec-side test as call/put wall and gamma flip above.
        asOf: levelProvenanceAsOf(gex, vec, vecKing != null ? "vector" : "gex"),
        freshness: vecKing != null ? vecFresh : gexFresh,
        market_session_note: vecKing != null ? vecSessionNote : gexSessionNote,
      },
    });
  }
  if (vec?.maxPain != null && !vectorStale) {
    levels.push({
      label: "max pain",
      price: vec.maxPain,
      provenance: {
        source: "Vector",
        asOf: levelProvenanceAsOf(gex, vec, "vector"),
        freshness: vecFresh,
        market_session_note: vecSessionNote,
      },
    });
  }
  return levels.slice(0, 10);
}

function evidenceFromContext(ctx: SwingPlayBriefContext, readMs: number): BieEvidence[] {
  const out: BieEvidence[] = [];
  // CLOSED play: `ctx.scanAsOf` is TODAY's live discovery-scan timestamp (the serving lane is
  // read unconditionally for every brief, closed or not, to feed `bookContextSection`'s sibling
  // comparison) — it has no bearing on a historical, already-graded outcome from a prior session.
  // `dataFreshnessSection` (play-brief-intel.ts) already gates its own "Swing scan: ..." prose
  // line behind this exact `isClosed` check for the same reason; this mirrors that gate so the
  // hidden `evidence[]`/markdown-footer array can't cite an irrelevant "recent" live scan as if
  // it supported a CLOSED play's claims (Ask Largo deep-dive, 2026-10-06, live repro: HUT).
  const isClosed = String(ctx.play.status ?? "").toUpperCase() === "CLOSED";
  if (ctx.scanAsOf && !isClosed) {
    const scanEt = etStampFromIso(ctx.scanAsOf);
    const staleScan =
      ctx.scanSessionDay && ctx.sessionDate && ctx.scanSessionDay !== ctx.sessionDate;
    out.push({
      kind: "fact",
      text: `Swing discovery scan as of ${scanEt}.`,
      provenance: { source: "Swing lane", asOf: scanEt, freshness: staleScan ? "stale" : "recent" },
    });
  }
  if (ctx.play.markAsOf) {
    const markMs = Date.parse(ctx.play.markAsOf);
    const markEt = etStampFromIso(ctx.play.markAsOf);
    // A swing option mark's only writer (swing-active-refresh) runs every 15 minutes, so a mark
    // 10-15 minutes old is on-schedule, not stale — the generic cross-product 10-minute bucket
    // (`freshnessFromObservedMs`) false-positives on exactly that window, which is why
    // `optionMarkIsStale` (play-brief-absence.ts) exists with an 18-minute cadence-aware
    // threshold. This evidence entry predates that fix and still called the generic bucket
    // directly, so it kept mislabeling an on-schedule mark as `stale` even after every other
    // freshness surface in this brief was corrected — live repro 2026-09-23, NVDA. Only downgrade
    // a generic "stale" verdict (never "live"/"recent", which the cadence-aware check can't make
    // fresher) so the future-skew fail-closed behavior (Largo C2) is untouched.
    const genericFreshness = Number.isFinite(markMs) ? freshnessFromObservedMs(markMs, readMs) : "unknown";
    const markFreshness =
      genericFreshness === "stale" && !optionMarkIsStale(ctx.play, readMs) ? "recent" : genericFreshness;
    out.push({
      kind: "fact",
      text: `Option mark as of ${markEt}.`,
      provenance: {
        source: "Swing ledger",
        asOf: markEt,
        freshness: markFreshness,
      },
    });
  }
  const eco = ctx.ecosystem;
  const gex = eco?.gex_positioning;
  // Cast to include VectorFreshnessBlock's `market_session`/`market_session_note` (PR #5306,
  // vector-state-freshness.ts): both `ctx.vector` (play-brief-context.ts, straight off
  // `fetchVectorFullState`) and `eco?.vector_full_state` (ecosystem-context.ts, through
  // `fitVectorFullStateForModel`, which carries the freshness block verbatim — see that module's
  // own header) genuinely have these fields at runtime; only the declared `VectorFullState` type
  // on `SwingPlayBriefContext`/`EcosystemContext` predates them. Cast locally rather than widening
  // either shared type, since nothing else in this file needs it.
  const vec = (ctx.vector ?? eco?.vector_full_state ?? null) as
    | (VectorFullState & Partial<VectorFreshnessBlock>)
    | null;
  const gexStale = gexMatrixStale(gex, readMs);
  const vectorStale = vectorSnapshotStale(vec, readMs, ctx.sessionDate);
  // BUG FIX (Largo Product Contract C2, 2026-10-16, Ask Largo standing mandate — live TSM/BBWI
  // repro): same fix as `levelsFromContext`'s own identically-named consts — see that function's
  // comment for the full write-up. Threaded onto the dealer-posture `calc` fact and the two
  // standalone market-session-note `fact` entries below, so every GEX/Vector-sourced provenance
  // block in this function carries the same additive disclosure `levelsFromContext` now does.
  const vecSessionNote = vectorStale ? null : (vec?.market_session_note ?? null);
  const gexSessionNote = gexMarketSessionNote(gex, readMs);
  // BUG FIX (2026-09-15, Ask Largo standing mandate, live repro TSM WATCH brief): this used to
  // compute `postureFromVec` as `vec?.regime?.posture != null ? ... : null`, treating the literal
  // string "unknown" (Vector genuinely could not resolve a regime) as an equally-resolved answer
  // to "long"/"short" — the exact same bug `resolveGammaPosture` (play-brief-absence.ts) was fixed
  // for on 2026-09-12, just never ported to this call site. Live: TSM's own evidence line read
  // "Dealer posture: γ unknown ..." while the SAME brief's "Trade manager read" narrative (which
  // already calls resolveGammaPosture) correctly said "dealers short gamma" from the GEX-matrix
  // fallback in the same moment. Delegating to the shared helper here too so this line can never
  // contradict the rest of the same envelope again.
  const gammaPosture = resolveGammaPosture(ctx, vec, readMs);
  const postureFromVec =
    vec?.regime?.posture != null && vec.regime.posture !== "unknown" && !vectorStale
      ? gammaPosture
      : null;
  if (gammaPosture) {
    const parts: string[] = [`γ ${gammaPosture}`];
    if (gex && !gexStale && Number.isFinite(gex.net_gex)) {
      // BUG FOUND (Ask Largo standing mandate, 2026-09-18, live repro ABTC $10.15 brief): a real,
      // signed net GEX under ~$50k (common on lower-priced/small-cap tickers) rounded to "0.0M" via
      // a plain toFixed(1) — reading as "no dealer exposure" when the sign and magnitude are both
      // real and meaningful for the posture read. formatFixedNonZero (inside formatDealerDollars)
      // widens precision only when the fixed rounding would otherwise collapse a real nonzero
      // value to a false zero.
      // BUG FOUND (Ask Largo standing mandate, 2026-10-14): a large net GEX (routinely the case on
      // SPY/SPX-scale tickers) rendered as e.g. "-17545.3M" under a fixed /1e6-then-"M" format —
      // formatDealerDollars picks M/B/T by magnitude instead, so this reads "-17.5B".
      parts.push(`net GEX ${gex.net_gex >= 0 ? "+" : ""}${formatDealerDollars(gex.net_gex)}`);
    }
    if (gex && !gexStale) {
      // Recompute against the SAME Vector-preferred call/put walls the levels array and narrative
      // display elsewhere in this brief — not the raw GEX-matrix-only `gex.nearest_wall` — so this
      // evidence line can never name a different strike than what the member sees as "put wall" /
      // "call wall" in the rest of the same envelope (found live 2026-09-08, NN SWING_NN_32: this
      // line said "nearest wall 13.00" while Levels-on-chart/Trade manager read both said put wall
      // 14.00, the live Vector wall — `gex.nearest_wall` only ever sees the GEX-matrix pair).
      const vecCallWallPosture = vectorStale ? undefined : vec?.gexWalls?.callWalls?.[0]?.strike;
      const vecPutWallPosture = vectorStale ? undefined : vec?.gexWalls?.putWalls?.[0]?.strike;
      const vecSpotPosture = vectorStale ? undefined : vec?.spot;
      const spotForWall = vecSpotPosture ?? gex.spot;
      const wall =
        spotForWall != null
          ? nearestWallFromLevels(
              vecCallWallPosture ?? gex.call_wall,
              vecPutWallPosture ?? gex.put_wall,
              spotForWall
            )
          : null;
      // BUG FIX (Ask Largo standing mandate, 2026-10-20, fresh-angle technicals audit, adversarially
      // verified): this used to pick the flip ONLY when no wall existed at all (`else if`), never
      // comparing the two — so a wall farther from spot than the flip still won here, naming a
      // "nearest wall" that wasn't actually nearest, the same bug shape fixed the same day in
      // gexPostureSection/chartLevelsSection (see nearestLevelWithFlip's own header). Also
      // previously read raw `gex.flip` with no Vector-preferred precedence at all; this call site
      // is already inside `gex && !gexStale`, so the Vector-preferred value is safe to read
      // unconditionally (flipFromStaleGex can never be true here — gex itself is confirmed fresh).
      const vecFlipPosture = vectorStale ? undefined : vec?.gammaFlip;
      const flipForWall = vecFlipPosture ?? gex.flip ?? null;
      const nearestLevel =
        spotForWall != null ? nearestLevelWithFlip(wall, flipForWall, false, spotForWall) : null;
      if (nearestLevel) {
        const levelLabel = nearestLevel.kind === "flip" ? "γ-flip" : "nearest wall";
        parts.push(`${levelLabel} ${fmtPriceLevel(nearestLevel.strike)} (${nearestLevel.distance_pts.toFixed(1)} pts)`);
      }
    }
    out.push({
      kind: "calc",
      text: `Dealer posture: ${parts.join(" · ")}`,
      provenance: {
        source: postureFromVec ? "Vector" : "GEX",
        asOf:
          (postureFromVec ? vec?.asOfEt ?? etStampFromIso(vec?.asOf) : null) ??
          gex?.as_of_et ??
          etStampFromIso(gex?.asof) ??
          ctx.asOf,
        freshness: postureFromVec ? vectorFreshness(vec, readMs) : gexFreshness(gex, readMs),
        market_session_note: postureFromVec ? vecSessionNote : gexSessionNote,
      },
    });
  }
  // Fast-follow to PR #5306 (Ask Largo standing mandate, 2026-09-20): #5306 shipped
  // `market_session_note` on the shared freshness block but deliberately stopped short of wiring
  // it anywhere — scoped in that PR's own description as "swing-scoped, safe fast-follow". The
  // note fires only for the misleading combination `describeVectorFreshness` exists to catch: a
  // weekend/holiday self-warm computes off the last close and reads `freshness: "live"`/`"recent"`
  // while the market itself has been shut for hours — gated `!vectorStale` so this can never
  // surface a caveat about a Vector read the rest of this function has already excluded from use
  // (session-mismatch staleness would already suppress it there; see the cast comment above for
  // why the self-warm scenario itself does NOT trip that gate).
  if (!vectorStale && vec?.market_session_note) {
    out.push({
      kind: "fact",
      text: vec.market_session_note,
      provenance: {
        source: "Vector",
        asOf: vec.asOfEt ?? etStampFromIso(vec.asOf) ?? ctx.asOf,
        freshness: vectorFreshness(vec, readMs),
        market_session_note: vecSessionNote,
      },
    });
  }
  // GEX-matrix sibling of the Vector block above (#4076 comment 5750099882, "Mechanism 2" —
  // #5306/#5307 shipped Vector's half; this is the GEX-matrix half, deliberately deferred to a
  // separate PR since `polygon-options-gex.ts` is a broader cross-desk surface). Same misleading
  // combination, different source: `gex.asof` is `polygon-options-gex.ts`'s own wall-clock
  // `calculatedAt`, so a weekend/holiday self-warm can compute a genuinely fresh GEX matrix from
  // Friday's closing chain while the market itself has been shut for hours. Gated `!gexStale` for
  // the same reason the Vector block is gated `!vectorStale` — this can never surface a caveat
  // about a GEX read the rest of this function has already excluded as untrustworthy.
  if (!gexStale && gexSessionNote) {
    out.push({
      kind: "fact",
      text: gexSessionNote,
      provenance: {
        source: "GEX",
        asOf: gex?.as_of_et ?? etStampFromIso(gex?.asof) ?? ctx.asOf,
        freshness: gexFreshness(gex, readMs),
        market_session_note: gexSessionNote,
      },
    });
  }
  const flow = trustedHelixFlow(eco);
  if (flow) {
    const bias =
      flow.call_premium > flow.put_premium * 1.3
        ? "call-heavy"
        : flow.put_premium > flow.call_premium * 1.3
          ? "put-heavy"
          : "balanced";
    out.push({
      kind: "fact",
      text: `HELIX flow (${flow.window_hours}h): ${bias} — calls ${fmtPremium(flow.call_premium)} · puts ${fmtPremium(flow.put_premium)} · ${flow.print_count} prints`,
      provenance: { source: "HELIX", asOf: ctx.asOf, freshness: "recent" },
    });
  }
  if (eco?.arsenal?.earnings?.earnings_date) {
    out.push({
      kind: "fact",
      text: `Next earnings ${eco.arsenal.earnings.earnings_date}.`,
      provenance: { source: "Earnings calendar", asOf: ctx.asOf, freshness: "recent" },
    });
  }
  const fund = eco?.arsenal?.fundamentals;
  if (fund && (fund.days_to_cover != null || fund.short_volume_ratio != null)) {
    // See FUNDAMENTALS_ANCIENT_CEILING_MS's comment (play-brief-absence.ts) — an ancient
    // short-interest read must be omitted rather than presented under the same "STALE" tag as a
    // genuinely few-days-old one. Shared with catalystsSection/shortInterestCoaching.
    if (!fundamentalsAncient(fund.as_of, readMs)) {
      const parts: string[] = [];
      if (fund.days_to_cover != null) parts.push(`DTC ${fund.days_to_cover.toFixed(1)}d`);
      if (fund.short_volume_ratio != null) {
        parts.push(`short vol ratio ${(fund.short_volume_ratio * 100).toFixed(0)}%`);
      }
      out.push({
        kind: "fact",
        text: `Short interest: ${parts.join(" · ")}`,
        provenance: {
          source: "Polygon / Benzinga",
          asOf: fund.as_of ? etStampFromDateOrIso(fund.as_of) ?? fund.as_of : ctx.asOf,
          freshness: fundamentalsFreshness(fund.as_of, readMs),
        },
      });
    }
  }
  // Largo C7 (2026-09-15, Ask Largo standing mandate): `bookContextSection`/`siblingPositionsNote`
  // assert concrete, checkable member-book facts ("already holding N same-direction positions in
  // theme X", "AAPL carries 2 concurrent live positions... entry $6.73, P&L -28.3%") off
  // ctx.openBook/ctx.laneRows, but this function — the sole feeder of envelope.evidence — never
  // touched either, an inconsistency with every other data-sourced narrative claim here, which all
  // get a matching evidence entry. Same gating as the sections themselves (CLOSED excluded,
  // checkPortfolioOverlap's own excludePositionId) so this can never disagree with what the member
  // reads in the section body.
  if (statusBucket(ctx.play) !== "closed" && ctx.openBook != null && ctx.openBook.length) {
    const { positionId } = parseSwingPlayId(ctx.play.id);
    const overlap = checkPortfolioOverlap(
      { ticker: ctx.play.ticker, direction: ctx.play.direction },
      ctx.openBook,
      positionId != null ? { excludePositionId: positionId } : undefined,
    );
    if (overlap.hasOverlap) {
      const parts: string[] = [];
      if (overlap.sameThemeSameDirection.length) {
        // BUG FIX (2026-10-21, Ask Largo standing mandate): mirrors the same-ticker/other-ticker
        // split just shipped in bookContextSection (play-brief-intel.ts) for the identical root
        // cause — this evidence fact hand-builds the SAME generic "theme X" framing off the SAME
        // overlap.sameThemeSameDirection array, so it carried the identical mislabeling: a literal
        // same-ticker duplicate (the sharpest concentration case) read as ordinary cross-ticker
        // sector overlap, disagreeing with the section body's own (now-fixed) sharper framing for
        // the identical fact.
        const reviewedTickerUpper = ctx.play.ticker.trim().toUpperCase();
        const sameTickerCount = overlap.sameThemeSameDirection.filter(
          (p) => p.ticker.trim().toUpperCase() === reviewedTickerUpper,
        ).length;
        const otherCount = overlap.sameThemeSameDirection.length - sameTickerCount;
        if (sameTickerCount && otherCount) {
          parts.push(
            `${sameTickerCount} same-ticker + ${otherCount} other same-direction position${otherCount > 1 ? "s" : ""} in ${describeThemeOverlap(overlap.theme)}`,
          );
        } else if (sameTickerCount) {
          parts.push(
            `${sameTickerCount} same-ticker same-direction position${sameTickerCount > 1 ? "s" : ""} on ${ctx.play.ticker} itself`,
          );
        } else {
          parts.push(
            `${overlap.sameThemeSameDirection.length} same-direction position${overlap.sameThemeSameDirection.length > 1 ? "s" : ""} in ${describeThemeOverlap(overlap.theme)}`,
          );
        }
      }
      if (overlap.sameThemeOpposedDirection.length) {
        parts.push(`${overlap.sameThemeOpposedDirection.length} opposed position(s) in the same theme`);
      }
      out.push({
        kind: "fact",
        text: `Book overlap: ${parts.join(" · ")}.`,
        provenance: { source: "Swing ledger", asOf: ctx.asOf, freshness: "recent" },
      });
    }
  }
  // BUG FOUND (Ask Largo standing mandate, 2026-10-15 — paired with the identical fix on
  // `siblingPositionsNote` above): this evidence[] feeder is supposed to carry "Same gating as the
  // sections themselves" (see the Largo C7 comment above the book-overlap block just above), but it
  // was STRICTER than `siblingPositionsNote` on two counts — `=== "open"` instead of `!== "closed"`,
  // and an unconditional `ctx.play.entry != null` requirement — so for a WATCH candidate it would
  // have silently disagreed with the section once that section was fixed to fire pre-entry: the
  // member would read the "Other concurrent position(s)" section body but find no matching
  // evidence[] entry backing it, the exact split this file's own C7 comment says must never happen.
  // Fixed in lockstep: gate on non-closed (matching book overlap) and only require an entry premium
  // for the self-test, not as a precondition to look at all — a pre-entry WATCH row can never
  // appear in laneRows with liveStatus set, so there is no self to accidentally exclude.
  //
  // BUG FIX (Ask Largo standing mandate, 2026-10-20): this block's own comment above claims it was
  // "Fixed in lockstep" with `siblingPositionsNote` and that the two "can never disagree" — but it
  // only ported THAT function's `!== "closed"` bucket gate and dropped-entry-precondition fix
  // (both from the 2026-10-15 pass), never the earlier (2026-10-11) `positionId` exact-match
  // branch `siblingPositionsNote` uses as its PRIMARY self-test (see that function, a few lines
  // above). Falling straight to the premium-proximity fallback here means two real, independently
  // committed same-ticker positions (legitimately distinct per commit.ts's per-archetype
  // `swingThesisKey`) whose entry premiums happen to land within $0.005 of each other (a realistic
  // fill collision) get silently excluded as "self" here — `siblingPositionsNote` correctly
  // resolves them via positionId and renders "Other concurrent position(s)", while this function
  // emits zero evidence[] entries backing that exact claim, violating the Largo C7 doctrine this
  // same function states two paragraphs up.
  if (statusBucket(ctx.play) !== "closed") {
    const ticker = ctx.play.ticker.toUpperCase();
    const hasOwnEntry = ctx.play.entry != null && Number.isFinite(ctx.play.entry);
    const { positionId: selfPositionId } = parseSwingPlayId(ctx.play.id);
    const siblingCount = ctx.laneRows.filter((r) => {
      if (r.ticker.toUpperCase() !== ticker) return false;
      if (!r.liveStatus) return false;
      if (r.entryPremium == null || !Number.isFinite(r.entryPremium)) return false;
      if (selfPositionId != null && r.positionId != null) {
        return r.positionId !== selfPositionId;
      }
      if (!hasOwnEntry) return true;
      return Math.abs(r.entryPremium - ctx.play.entry!) > 0.005;
    }).length;
    if (siblingCount > 0) {
      // BUG FIX (2026-10-21, Ask Largo standing mandate): same unconditional "+1" overcounting fix
      // as `siblingPositionsNote` above (this block's own stated purpose is to never disagree with
      // that section) — only count the subject play itself when it actually has an entry premium.
      const total = siblingCount + (hasOwnEntry ? 1 : 0);
      out.push({
        kind: "fact",
        text: `${ticker} carries ${total} concurrent live position(s) — this brief covers one.`,
        provenance: { source: "Swing ledger", asOf: ctx.asOf, freshness: "recent" },
      });
    }
  }
  // Largo C10 (historical context) enhancement (2026-09-20, Ask Largo standing mandate):
  // archetypeTrackRecordSection/tickerTrackRecordSection (play-brief-intel.ts) already cite C10 in
  // their own doc comments and render these same wins/losses/n numbers — but only into the "Track
  // record"/"Ticker track record" SECTIONS' prose, never into evidence[], so the numbers were
  // joinable/citable only as free text, not as a typed fact with its own provenance the way every
  // other evidence[] line in this function is. Additive per the contract's wrap-don't-flatten
  // rule — the prose sections are untouched; these are new evidence[] lines carrying the SAME
  // numbers with real provenance, closing the gap those two sections' own comments already named
  // without solving (a full dedicated Largo tool, C10's stated ideal, is a larger, separate call).
  const swingArchetype = (SWING_ARCHETYPES as readonly string[]).includes(ctx.play.archetype ?? "")
    ? (ctx.play.archetype as (typeof SWING_ARCHETYPES)[number])
    : null;
  const graduatedEntry = graduatedArchetypeEntry(ctx.archetypeTrackRecord, swingArchetype);
  if (graduatedEntry && swingArchetype && ctx.archetypeTrackRecord) {
    const snapshotMs = Date.parse(ctx.archetypeTrackRecord.asOf);
    // BUG FIX (2026-10-20, Ask Largo standing mandate): this used the generic 10-minute
    // `freshnessFromObservedMs` bucket directly, the same false-positive this file already found
    // and fixed for the sibling `markAsOf` fact below (`optionMarkIsStale`) — a snapshot written by
    // the identical 15-minute-cadence cron landing 10-15 minutes after its last tick (a normal
    // ~1/3 of every cycle, not a missed tick) was mislabeled "stale". `archetypeTrackRecordIsStale`
    // uses this data's own documented staleness horizon (calibration-cache.ts's
    // SWING_ARCHETYPE_TRACK_RECORD_TTL_SEC) instead — looser than the option mark's 18 minutes,
    // since this data legitimately moves far slower. Only downgrades a generic "stale" verdict
    // (never "live"/"recent"), same fail-closed-on-future-skew discipline as the option mark fix.
    const genericArchetypeFreshness = Number.isFinite(snapshotMs)
      ? freshnessFromObservedMs(snapshotMs, readMs)
      : "unknown";
    const archetypeFreshness =
      genericArchetypeFreshness === "stale" && !archetypeTrackRecordIsStale(ctx.archetypeTrackRecord.asOf, readMs)
        ? "recent"
        : genericArchetypeFreshness;
    out.push({
      kind: "fact",
      text: `Archetype track record: ${ARCHETYPE_META[swingArchetype].label} ${graduatedEntry.wins}W / ${graduatedEntry.losses}L across ${graduatedEntry.n} graded plays (Wilson 95% floor ${graduatedEntry.wilsonLbPct.toFixed(0)}%).`,
      provenance: {
        source: "Swing ledger",
        asOf: etStampFromIso(ctx.archetypeTrackRecord.asOf) ?? ctx.asOf,
        freshness: archetypeFreshness,
      },
    });
  }
  const tickerRecord = ctx.tickerTrackRecord;
  if (tickerRecord && tickerRecord.priorClosedTrades > 0) {
    out.push({
      kind: "fact",
      text: `Ticker track record: ${tickerRecord.ticker} ${tickerRecord.wins}W / ${tickerRecord.losses}L across ${tickerRecord.priorClosedTrades} prior closed trade${tickerRecord.priorClosedTrades === 1 ? "" : "s"}.`,
      provenance: { source: "Swing ledger", asOf: ctx.asOf, freshness: "recent" },
    });
  }
  if (ctx.play.rollCandidate) {
    out.push({
      kind: "fact",
      text: `Theta vs thesis alert — candidate for rolling to later expiry.`,
      provenance: { source: "Swing lane", asOf: ctx.asOf, freshness: "recent" },
    });
  }
  return out;
}

// SITUATIONAL_FOLLOWUP_BY_MANAGE_ACTION (Ask Largo standing mandate, aggressive-improvement-
// hunting pass, 2026-09-23): before this, every OPEN play got the identical five followups
// regardless of state — a position sitting right on its stop and a winner already trimming got
// the same generic chips. Live spot-check that day: SKHY at -48.4% (HOLD, thesis intact) and
// RBRK at +124.4% (TAKE_PARTIAL, ladder already firing) both rendered byte-identical followups[].
// The manage-engine verdict (`play.manageAction`) is already computed and already rendered in the
// brief's own Management section, so surfacing it here as a targeted suggestion chip is a read
// of data the brief already has, not a new dependency.
//
// COVERAGE FIX (same mandate, later the same day): the first cut only mapped the three
// ScaleOutAction values (Banger-lineage — TAKE_PARTIAL/EXIT_RUNNER/STOP_OUT). `SwingManageAction`
// is `ScaleOutAction | "EXIT" | "ADD"` (manage.ts) — EXIT and ADD are the NATIVE swing_positions
// verdicts (`live-plays.ts`'s `manageObservablesFromEvent`), so a native position with a broken
// thesis (manageAction: "EXIT") got no situational chip at all — arguably the state most worth
// one. Confirmed live: NVDA/HUT/AAPL (native, HOLD) correctly get nothing, but nothing in the
// live sample happened to be in EXIT/ADD at spot-check time — added from reading the type, not a
// live repro of the miss, so tested directly rather than inferred as fixed.
const SITUATIONAL_FOLLOWUP_BY_MANAGE_ACTION: Partial<Record<NonNullable<TerminalPlay["manageAction"]>, string>> = {
  TAKE_PARTIAL: "Should I trim more?",
  EXIT_RUNNER: "Why exit the runner now?",
  STOP_OUT: "Why is this at its stop?",
  EXIT: "Why exit now?",
  ADD: "Should I add to this?",
};

function followupsFor(play: TerminalPlay): string[] {
  const t = play.ticker;
  const bucket = statusBucket(play);
  const base = [
    `Show ${t} GEX walls on chart`,
    `HELIX flow on ${t} last 24h`,
    `Vector technicals for ${t}`,
  ];
  if (bucket === "open") base.unshift(`What changed on ${t} since entry?`);
  if (bucket === "watch") base.unshift(`When does ${t} entry trigger?`);
  if (bucket === "closed") base.unshift(`What did we learn from ${t}?`);
  if (bucket === "open" && play.manageAction) {
    const situational = SITUATIONAL_FOLLOWUP_BY_MANAGE_ACTION[play.manageAction];
    if (situational) base.push(`${situational} (${t})`);
  }
  base.push(`Open full Largo for ${t}`);
  return base;
}

/**
 * BUG FOUND (Ask Largo standing mandate, 2026-09-20): mirrors the identical composition-level gap
 * already found and fixed for `buildIntelSections`'s ~20 sections (PR #5288, play-brief-intel.ts)
 * — THIS file's own top-level section builders (Management/Thesis health/Position/Entry/Outcome/
 * sibling-position disclosure) plus the evidence/levels/structure-ladder builders below were called
 * bare too, with the identical blast radius: one throw anywhere in `composeSwingPlayBrief` itself
 * propagates through to the API route's top-level catch (`route.ts`), which returns
 * `{available:false, degraded:true}` (503) — the ENTIRE brief disappears, Verdict included, even
 * though every other top-level section would have built fine.
 *
 * Live repro (regression test below): `managementSection`'s `ep.trim_levels.map(...)` is
 * unconditional whenever `play.exitPolicy` is set — `TerminalPolicyInput.trim_levels` is typed as
 * a required array (exit-policy.ts), but nothing here defended against a degraded row carrying a
 * different runtime shape — the exact same "typed non-optional, not actually guaranteed" gap #5288
 * found in `TerminalPlay.factors`, just surfacing in a sibling function.
 *
 * `safeCompose` gives each of these top-level calls the same fail-soft behavior `buildIntelSections`
 * already has (post-#5288): log server-side only, fall back to the caller-supplied value (`null` for
 * an optional section, `[]` for an evidence/levels array) rather than crash the whole envelope.
 * Deliberately scoped to THIS function's own top-level composition — `buildIntelSections`'s 20
 * sections are independently protected by #5288 and not duplicated here (single-issue PRs, per this
 * repo's standing policy).
 */
// BUG FOUND (Ask Largo standing mandate, 2026-10-07): #5288's fail-soft fallback above correctly
// keeps the brief alive when a builder throws, but for `evidence`/`levels` specifically it falls
// back to `[]` — which is byte-identical to "this product genuinely has no evidence/levels to
// show" and is exactly the shape the contract's own C3 names as the dangerous one ("Never return
// [] / null / {} for 'unavailable'... any fallback that returns a degraded result the caller
// cannot distinguish from a real one is a defect even when every test passes"). A build failure
// here is silently indistinguishable from "we checked and there's nothing" to any downstream
// Largo reader — including the model itself, which has no way to know the array it's looking at
// is a crash fallback rather than a real empty read. `onFailure` lets evidence/levels record WHICH
// builder failed without changing their own `[]` fallback (still correct — don't fabricate fake
// evidence/levels to "fix" this), so the caller can fold that into `unavailableSources` instead.
function safeCompose<T>(label: string, build: () => T, fallback: T, onFailure?: (label: string) => void): T {
  try {
    return build();
  } catch (error) {
    console.error(`[swing/play-brief] "${label}" threw — falling back, not failing the brief`, error);
    onFailure?.(label);
    return fallback;
  }
}

export type ComposeSwingPlayBriefOptions = {
  /** When true, keep redundant intel sections (GEX, Flow, Hold plan, etc.) alongside narrative. */
  expandIntel?: boolean;
};

/** Compose a full BieAnswerEnvelope for the selected swing play. */
export function composeSwingPlayBrief(
  ctx: SwingPlayBriefContext,
  opts?: ComposeSwingPlayBriefOptions,
): SwingPlayBriefResult {
  const readMs = Date.now();
  // Stamp the canonical "now" onto ctx ONCE, before any section composes, so every staleness
  // check downstream that reads `ctx.readMs` (rather than sampling `Date.now()` itself) agrees on
  // the same instant — see the field's own doc comment (play-brief-types.ts) for the live repro
  // this fixes. `ctx.readMs ?? readMs` keeps an already-stamped ctx (e.g. a caller that composes
  // multiple briefs off one shared anchor) untouched rather than overwriting it.
  ctx = { ...ctx, readMs: ctx.readMs ?? readMs };
  const { play } = ctx;
  // BUG FIX (2026-10-17, Ask Largo standing mandate, live repro VXX/SQQQ/SOXS/UVIX): this used to
  // hardcode "equity" below on the stale assumption that swings are always equities — true when
  // this field was added, no longer true once the Banger whole-market engine started feeding
  // leveraged/inverse/volatility ETFs into the swing lane. Mirrors the same fix already shipped for
  // product-adapters.ts's cross-product reads (same root cause, different file).
  const tickerClass = canonicalTicker(play.ticker)?.kind ?? "equity";
  const bucket = statusBucket(play);
  const headline = playContractHeadline(play);
  const grade = playGradeLabel(play);
  const quality = playQualityPct(play);
  const strength = thesisStrengthPct(play);

  const verdictLines: string[] = [];
  const action = swingActionDisplay(play);
  // Fallback chain must match the envelope headline's below (action -> recommendation -> status)
  // — a SKIP-deckStatus RESEARCH row otherwise showed "HOLD" in the headline and raw "· SKIP"
  // here in the very same brief (live repro: SLV, 2026-09-10, FINDINGS 2026-09-10).
  verdictLines.push(`**${headline}** · ${play.direction} · ${action?.label ?? play.recommendation ?? play.status}`);
  if (grade) verdictLines.push(`Grade **${grade}**${quality != null ? ` · score ${quality}` : ""}`);
  if (strength != null) verdictLines.push(`Thesis strength **${strength}%**`);
  // Dossier regime (discovery-pillar read, e.g. "Breakout · regime 0.82") belongs in "Why this setup"
  // — not Verdict. It is not Vector/SPX market regime and duplicates archetype when both are present.
  const verdictArchetypeLabel = archetypeLabelFromRaw(play.archetype);
  if (verdictArchetypeLabel) verdictLines.push(`Archetype: ${verdictArchetypeLabel}`);
  if (play.recNote && bucket === "watch") verdictLines.push(play.recNote);

  const sections: RichSection[] = [{ title: "Verdict", body: verdictLines.join("\n\n") }];

  // BUG FIX (Ask Largo x Night Hawk Swings standing mandate, 2026-10-19): hoisted above the bucket
  // branches below (was previously declared only after them, at the point buildIntelSections was
  // called) so every top-level safeCompose call in THIS function — not just evidence/levels and
  // buildIntelSections's own 20 sections — can feed the same collector. The 2026-10-07 fix's own
  // comment on `safeCompose` above already names the exact defect this closes: a `[]` fallback (or,
  // here, a silently-omitted section) "is byte-identical to 'this product genuinely has no
  // evidence/levels to show'... a build failure here is silently indistinguishable from 'we checked
  // and there's nothing' to any downstream Largo reader" — and explicitly notes "the caller can fold
  // that into unavailableSources instead." That fold was wired for evidence/levels and for
  // buildIntelSections's sections, but never extended to Management/Thesis health/Position/Entry/
  // Outcome/the sibling-position disclosure/structureLadder — the seven other safeCompose calls in
  // this function, all still passed no `onFailure` (confirmed by reading every call site below: each
  // one was still `safeCompose(label, fn, null)`, three args, matching the ORIGINAL 2026-09-20
  // #5288-sibling fix's shape, before the 2026-10-07 fix added the fourth `onFailure` parameter at
  // all). The existing regression test below this function (`a throwing top-level section
  // (Management/Position) does not take down the whole brief`) already proves these sections can
  // throw on a realistic degraded row and get silently omitted — it just never checked whether that
  // omission was disclosed anywhere, because until this fix it genuinely was not: a member asking
  // Largo "how should I manage this open position" on a row whose `exitPolicy.trim_levels` came back
  // malformed got a brief with no Management section, no Position section, and no
  // `unavailableSources` entry naming either one — indistinguishable from "nothing to report" (Largo
  // C3: "any fallback that returns a degraded result the caller cannot distinguish from a real one is
  // a defect even when every test passes").
  const buildFailures: string[] = [];
  const trackBuildFailure = (label: string) => buildFailures.push(label);

  if (bucket === "watch") {
    // BUG FIX (Ask Largo standing mandate, 2026-10-12): used the outer `readMs` local (always the
    // real `Date.now()` from this function's top) instead of `ctx.readMs`, which line ~1354 above
    // deliberately stamps to an already-injected override when one is present — exactly the pattern
    // play-brief-types.ts's `readMs` doc comment asks every downstream call site to follow, and the
    // "other ~18 Date.now() call sites" note there already flagged this class of gap as a known,
    // deferred sweep. Surfaced while adding a determinism-pinned regression test for the sub-24h
    // entry-window fix below: a test that injects `ctx.readMs` to pin "now" silently had no effect
    // on this section, which kept reading the real wall clock regardless.
    const watchSection = safeCompose("Entry", () => watchEntrySection(play, ctx.readMs ?? readMs), null, trackBuildFailure);
    if (watchSection) sections.push(watchSection);
    // BUG FOUND (Ask Largo standing mandate, 2026-10-15): `siblingPositionsNote` was never even
    // CALLED from this branch — the function-level `play.entry == null` guard fixed just above is
    // necessary but not sufficient, because the call site itself only invoked this section for
    // `bucket === "open"`. Added here so a WATCH candidate on a ticker that already carries a real
    // committed sibling position gets the same disclosure an open position would.
    const watchSiblings = safeCompose("Other concurrent position(s)", () => siblingPositionsNote(ctx), null, trackBuildFailure);
    if (watchSiblings) sections.push(watchSiblings);
  } else if (bucket === "open") {
    const mgmt = safeCompose("Management", () => managementSection(play), null, trackBuildFailure);
    if (mgmt) sections.push(mgmt);
    const th = safeCompose("Thesis health", () => thesisHealthSection(play), null, trackBuildFailure);
    if (th) sections.push(th);
    const pnl = safeCompose("Position", () => pnlSection(play, ctx.readMs ?? readMs), null, trackBuildFailure);
    if (pnl) sections.push(pnl);
    const siblings = safeCompose("Other concurrent position(s)", () => siblingPositionsNote(ctx), null, trackBuildFailure);
    if (siblings) sections.push(siblings);
  } else {
    const closed = safeCompose("Outcome", () => closedSection(play), null, trackBuildFailure);
    if (closed) sections.push(closed);
  }

  sections.push(
    ...buildIntelSections(ctx, bucket, { collapseIntel: !opts?.expandIntel, onFailure: trackBuildFailure }),
  );

  // Prefer a real per-ticker technical break level (put wall/gamma flip/call wall — same
  // computation the "Trade manager read" narrative's own "Break watch" bullet uses) over the
  // raw commit-gate reason. The gate reason is frequently a SYSTEM-WIDE operational block (e.g.
  // G-S12 halt-feed-stale) that reads identically across every gate-blocked ticker on the board
  // at once and tells a trader nothing about THIS setup — see resolveBreakInvalidation's own
  // comment for the live evidence. Gate reason / premium stop stay as fallbacks for when no real
  // level is computable (no live spot, no walls/flip at all).
  //
  // CLOSED plays are excluded entirely (live repro 2026-09-12: NVDA/TSM, both STOPPED weeks
  // earlier, still rendered a labeled "Invalidation" callout reading "Break watch — lose X on a
  // closing basis -> structural support failed; exit or cut size." computed off TODAY's live
  // spot/walls). That "exit or cut size" language is live trade-management guidance for a
  // position that no longer exists — a CLOSED play has nothing left to invalidate. None of the
  // three fallbacks in this chain checked `bucket` (only the premium-stop fallback already did,
  // and only for `open`), so a resolvable technical level kept firing for closed rows too.
  // BUG FIX (Ask Largo standing mandate, 2026-09-18): a WATCH play whose entry is already dead
  // (`deadPlayReason` — `watchEntryExpired`/`setupState === "INVALIDATED"`) fell straight through
  // to `play.gateBlocks?.[0]?.reason` below, the same MOOT gate text `watchEntrySection`'s own
  // "Also gate-blocked (moot — ...)" header and `entryTriggerDeadReason`'s "Entry trigger" line
  // (both this file/play-brief-intel.ts, already fixed for this exact root cause) explicitly warn
  // is no longer what's actually stopping entry. Live repro: MU WATCH brief, 2026-09-17/18 —
  // headline correctly read "EXPIRED — wait for a fresh setup" and the Entry section correctly
  // labeled its one gate "(moot — entry-validity window expired)", but the SAME brief's top-level
  // **Invalidation:** evidence-block line still read "Trading-halt feed unavailable — desk will
  // not open until halt/LULD data recovers" — the moot gate, presented with no "moot" qualifier,
  // as if clearing it would reopen entry. `deadPlayReason` is already imported in this file for
  // `watchEntrySection`'s identical check; scoped to `bucket === "watch"` to match its two sibling
  // call sites exactly and leave OPEN/CLOSED invalidation logic untouched.
  const dead = bucket === "watch" ? deadPlayReason(play) : null;
  // BUG FIX (Ask Largo standing mandate, 2026-10-16, Bug 3 of the standing Ask Largo x Night Hawk
  // Swings mandate — live META repro). `resolveBreakInvalidation` returns null whenever it cannot
  // resolve a live spot from EITHER Vector or GEX (see its own comment) — and that null has (at
  // least) two structurally different causes this chain's own fallback used to treat identically:
  // (1) the per-ticker read genuinely has no resolvable level (cold/absent data, a normal, honest
  // "nothing to compute" case the comment above this block already documents the gate-reason
  // fallback as the correct answer for), and (2) THIS ticker's own ecosystem/Vector context fetch
  // FAILED this cycle (`ctx.ecosystemFetchFailed`/`ctx.vectorFetchFailed` — already surfaced
  // elsewhere in this SAME envelope via `collectBriefUnavailableSources`'s "ecosystem context:
  // fetch failed"/"Vector state: fetch failed" entries), which is a transient, per-ticker, this-
  // cycle-only failure, not an honest absence of data to compute from.
  //
  // Live repro: META WATCH brief, 2026-10-16 01:57 UTC — `envelope.invalidation` read the literal
  // `g_s12_halt_feed_stale` gate reason ("Trading-halt feed unavailable...") while META's
  // `setupState` was `"FORMING"`/`entryStatus "PRE_TRIGGER"` (not dead) and `unavailableSources`
  // listed META's own ecosystem/Vector fetch as failed — CloudWatch confirmed both reads timed out
  // for META specifically at that exact timestamp. The SAME gate reason renders identically for
  // EVERY ticker blocked by that gate right now (this file's own comment two paragraphs up already
  // names this as the reason a real per-ticker level is preferred over it) — presenting it here,
  // with no indication the per-ticker read simply never ran this cycle, reads as "this IS what
  // invalidates META" when it is really "we don't know what invalidates META this cycle."
  //
  // Fix: when the fetch itself failed, never substitute the shared gate-block text as if it were
  // META's real per-ticker answer — fall through past it instead. The per-position premium-stop
  // fallback (a genuine, ticker-specific number from this position's own ledger row, not a shared
  // system string) is left reachable either way: a fetch failure says nothing about whether that
  // real number exists. The member already sees the HONEST reason this field has nothing more
  // specific to say via `unavailableSources` in this same response (Largo C3 — absence must read
  // as absence, never as a different fact dressed up as the real one) — no separate caveat string
  // is invented here, mirroring the `dead`-case fix above's own choice to reframe the EXISTING
  // text rather than fabricate a new one, except here the honest move is omission, not reframing,
  // since there is no real per-ticker fact to reframe.
  const sourceFetchFailed = ctx.ecosystemFetchFailed === true || ctx.vectorFetchFailed === true;
  const invalidation =
    bucket === "closed"
      ? null
      : play.thesisBreak?.level === "break"
        ? play.thesisBreak.note ?? "Thesis break — structural invalidation fired."
        : dead
          ? `${dead.charAt(0).toUpperCase()}${dead.slice(1)} — this setup is no longer live.`
          : resolveBreakInvalidation(ctx) ??
            (sourceFetchFailed ? null : play.gateBlocks?.[0]?.reason) ??
            (bucket === "open" && play.exitPolicy?.stop_premium != null
              ? `Premium stop at ${fmtUsd(play.exitPolicy.stop_premium)}`
              : null);

  // BUG FIX continued (Ask Largo standing mandate, 2026-10-07): evidence/levels are now composed
  // BEFORE unavailableSources rather than inline inside the envelope literal, so a build failure
  // recorded via `buildFailures` (declared above, now ALSO fed by buildIntelSections — see the
  // 2026-10-10 comment on that call) can be folded into the SAME `unavailableSources` list the
  // envelope field and `confidence` both read — otherwise a build failure would have nowhere
  // honest to surface (the pre-existing `[]` fallback alone looks identical to a real empty read).
  // BUG FIX (Ask Largo x Night Hawk Swings standing mandate, 2026-10-19 — round 5 of the deep-dive):
  // same gap the 2026-10-12 fix closed for watchEntrySection/pnlSection above (bare `readMs` local —
  // always the real `Date.now()` sampled at this function's top — instead of `ctx.readMs ?? readMs`,
  // which respects an already-injected shared anchor). evidenceFromContext/levelsFromContext are the
  // sole feeders of envelope.evidence/envelope.levels and were never part of that fix's blast-radius
  // check, so two more of play-brief-types.ts's own documented "~18 Date.now() call sites" follow-up
  // were still open. Currently latent in production (the one real caller never pre-stamps
  // ctx.readMs), but reverts to the exact already-fixed bug class (2026-09-21 SNXX repro) the moment
  // any caller or test pins a shared anchor — see this file's own regression test for the live proof.
  const evidence = safeCompose("evidence", () => evidenceFromContext(ctx, ctx.readMs ?? readMs), [], trackBuildFailure);
  const levels = safeCompose("levels", () => levelsFromContext(ctx, ctx.readMs ?? readMs, bucket), [], trackBuildFailure);

  // BUG FIX (Ask Largo x Night Hawk Swings standing mandate, 2026-10-19): moved up from inside the
  // envelope literal below, to BEFORE `unavailableSources` is assembled. It was previously computed
  // inline as the envelope's `structureLadder` field — after `unavailableSources` had already been
  // built and baked into `buildRichEnvelope({ unavailableSources, ... })` a few lines down — so a
  // `trackBuildFailure("structureLadder")` call from inside it could never reach the array it was
  // supposed to feed; the ordering, not a missing `onFailure` argument, was the actual defect once
  // one was added. Same real-row risk as every other safeCompose call in this function:
  // `buildStructureLadder` reads live spot/GEX/structural-node data off `ctx`/`play` with no
  // guarantee every field is present.
  const structureLadder = safeCompose("structureLadder", () => buildStructureLadder(ctx, play, bucket), null, trackBuildFailure);

  // Computed once and shared by the envelope's own `unavailableSources` chips AND `confidence`
  // below, so the two can never drift apart (the same class of narrative-vs-chip disagreement
  // this file has already fixed elsewhere for readMs — see collectBriefUnavailableSources's header).
  // A build failure above (now including `structureLadder`, Management, Thesis health, Position,
  // Entry, Outcome, and the sibling-position disclosure — see this function's own `buildFailures`
  // doc comment near the top) is folded in here as its own honest entry — distinct from a real data
  // absence (`collectBriefUnavailableSources`'s own checks), but equally something the model must
  // not read as "zero evidence/levels exist," per Largo C3.
  const unavailableSources: BieUnavailableSource[] = [
    ...collectBriefUnavailableSources(ctx),
    ...buildFailures.map((label) => ({
      source: "Swing play-brief internals",
      reason: `"${label}" failed to build this cycle — treat as unknown, not as a confirmed empty/zero read.`,
      what_is_missing: label,
      retryable: true,
    })),
  ];

  const envelope: BieAnswerEnvelope = {
    ...buildRichEnvelope({
      headline: `${action?.label ?? play.recommendation ?? play.status} — ${headline}`,
      bias: biasFromDirection(play.direction),
      intent: "swing_play_brief",
      sections,
      evidence,
      levels,
      invalidation,
      followups: followupsFor(play),
      unavailableSources,
      // Largo C6 (Ask Largo standing mandate, 2026-09-26 — see play-brief-confidence.ts's header
      // for why this is NOT computeSwingThesisHealth's %): evidence-coverage confidence, never a
      // directional/win-probability read. Never throws by construction (pure, total function over
      // already-validated inputs), but routed through safeCompose for the same defensive
      // consistency every other envelope field in this composer gets.
      confidence: safeCompose(
        "confidence",
        () => swingPlayBriefConfidence(play, bucket, unavailableSources),
        undefined
      ),
      // Largo C4 (IDENTITY): derive from the ticker itself — see the bug-fix comment at this
      // function's top for why this can no longer be hardcoded "equity".
      ticker_class: tickerClass,
    }),
    // Largo C8 (PROVENANCE): the brief is computed by the Swing Play Intelligence engine.
    source: "computed",
    asOf: ctx.asOf,
    session_date: ctx.sessionDate,
    // Largo C5 (DIRECTION) / C8 (NARRATIVE) fix — see `briefThesis`'s own doc comment above for
    // the full account (built on the 2026-10-18 staged finding). `direction` is the same native
    // source `bias` above already derives from (`biasFromDirection(play.direction)`), kept here
    // as the raw "LONG"/"SHORT" label rather than flattened into bias's normalized read.
    direction: play.direction,
    thesis: briefThesis(play, headline, action, verdictArchetypeLabel),
    // Structure Ladder widget (Ask Largo standing mandate, 2026-09-12) — null on CLOSED plays and
    // on any read with no live spot/structural nodes to build from; never fabricated. Computed
    // above, before `unavailableSources`, so a build failure here reaches that list — see this
    // local's own doc comment for why the ordering matters.
    structureLadder,
  };

  const flow = trustedHelixFlow(ctx.ecosystem);
  const flowSnapshot = flow
    ? { callPremium: flow.call_premium, putPremium: flow.put_premium }
    : null;

  const trimsFired = play.exitPolicy?.trim_levels?.filter((t) => t.fired).length ?? null;
  // Diff snapshots must read spot/walls/flip from envelope.levels (already stale-gated in
  // levelsFromContext) — not a parallel vec/gex fallback that bypasses freshness gates.
  const snap = snapshotFromBrief(
    envelope,
    play,
    extrasFromBriefResponse({ envelope, flowSnapshot, trimsFired }),
  );

  return {
    playId: play.id,
    ticker: play.ticker,
    ticker_class: tickerClass,
    envelope,
    asOf: ctx.asOf,
    sessionDate: ctx.sessionDate,
    engine: "swing_play_intelligence",
    flowSnapshot,
    briefContentKey: briefContentKey(snap),
    trimsFired,
  };
}
