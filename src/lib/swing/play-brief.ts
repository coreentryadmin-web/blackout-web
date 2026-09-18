/**
 * Swing Play Intelligence Engine — deterministic, real-time play brief composer.
 * No Anthropic calls. Every claim traces to platform data with null-honesty.
 */
import type { BieAnswerEnvelope, BieBias, BieEvidence, BieFreshness, BieLevel } from "@/lib/bie/answer-envelope";
import { freshnessFromAgeMs, freshnessFromObservedMs } from "@/lib/bie/answer-envelope";
import { describeVectorFreshness } from "@/lib/bie/vector-state-freshness";
import type { GexPositioning } from "@/lib/providers/gex-positioning";
import { nearestWallFromLevels } from "@/lib/providers/gex-nearest-wall";
import type { VectorFullState } from "@/lib/bie/vector-full-state";
import type { ConfluenceZone } from "@/features/vector/lib/vector-confluence";
import { buildRichEnvelope, type RichSection } from "@/lib/bie/rich-narrative";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import { playContractHeadline } from "@/features/nighthawk/command-deck/play-card-lifecycle";
import { playGradeLabel, playQualityPct } from "@/features/nighthawk/command-deck/play-card-display";
import { swingActionDisplay } from "@/features/nighthawk/command-deck/play-card-lifecycle";
import { thesisStrengthPct } from "@/features/nighthawk/command-deck/terminal-display";
import type { SwingPlayBriefContext, SwingPlayBriefResult } from "./play-brief-types";
import { archetypeLabelFromRaw, SWING_SUB_LANES, type SwingSubLane } from "./taxonomy";
import {
  collectBriefUnavailableSources,
  confluenceZoneKindsLabel,
  fundamentalsAncient,
  fundamentalsObservedMs,
  gexMatrixAgeMs,
  gexMatrixStale,
  optionMarkGenuinelyUnknown,
  playExpectsLiveOptionMark,
  resolveGammaPosture,
  trustedHelixFlow,
  vectorSnapshotStale,
} from "./play-brief-absence";
import { buildIntelSections } from "./play-brief-intel";
import { checkPortfolioOverlap } from "./portfolio";
import { describeThemeOverlap } from "./theme-cluster";
import { parseSwingPlayId } from "./play-brief-resolve-pure";
import { deadPlayReason } from "./entry-enterability";
import { buildStructureLadder } from "./play-brief-ladder";
import { resolveBreakInvalidation } from "./play-brief-narrative";
import { briefContentKey, extrasFromBriefResponse, snapshotFromBrief } from "./play-brief-diff";
import { fmtOptionUsd as fmtUsd, fmtPremium } from "@/lib/fmt-money";
import { etStampFromDateOrIso, etStampFromIso } from "@/lib/largo/temporal/bar-session-date";
import { thesisHealthUncalibrated } from "./thesis-health";

function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

function biasFromDirection(dir: string): BieBias {
  return dir === "SHORT" ? "bearish" : dir === "LONG" ? "bullish" : "neutral";
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
    return {
      title: "Thesis health",
      body:
        "Inputs not wired for committed positions — aggregate score withheld; pillar breakdown not shown.",
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
  return {
    title: "Thesis health",
    body: `**${h.health}%** · ${h.rungLabel}\n\n${rows || "Pillars not wired on this row."}`,
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
      lines.push(`Rails: stop ${fmtUsd(ep.stop_premium)} · target ${fmtUsd(ep.target_premium)}`);
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
 * on the same ticker by its distinguishing contract + entry so nothing is hidden. Matches on
 * `entryPremium` (rounded) rather than a synthetic id, since two genuinely different positions on
 * one ticker always differ in strike/expiry/entry price in practice — good enough for an honest
 * disclosure, not a resolution key.
 */
function siblingPositionsNote(ctx: SwingPlayBriefContext): RichSection | null {
  const { play } = ctx;
  if (play.entry == null || !Number.isFinite(play.entry)) return null;
  const ticker = play.ticker.toUpperCase();
  const siblings = ctx.laneRows.filter((r) => {
    if (r.ticker.toUpperCase() !== ticker) return false;
    if (!r.liveStatus) return false; // only OTHER live/committed positions matter here
    if (r.entryPremium == null || !Number.isFinite(r.entryPremium)) return false;
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
  return {
    title: "Other concurrent position(s)",
    body: `${ticker} carries ${siblings.length + 1} concurrent live position(s) — this brief covers one. Other(s):\n\n${lines.join("\n")}\n\nPass a specific strike/expiry to review a different one.`,
    bias: "neutral",
  };
}

function pnlSection(play: TerminalPlay): RichSection {
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
  const lines = [
    `Entry: **${fmtUsd(play.entry)}**`,
    markGenuinelyUnknown
      ? `Mark: **unknown** _(sync quote, no live price yet — do not read as flat)_`
      : markUnsynced
        ? `Mark: **${fmtUsd(play.mark)}** _(live quote, no freshness timestamp)_`
        : `Mark: **${fmtUsd(play.mark)}**${play.markAsOf ? ` (${etStampFromIso(play.markAsOf)})` : ""}`,
    `P&L: **${fmtPct(play.pnlPct)}**${blended != null ? " _(open runner only — trim already banked, see below)_" : ""}`,
    `Peak: **${fmtPct(play.peak)}**`,
    // ENHANCEMENT (2026-09-15, Ask Largo standing mandate, live repro SWING:CRWD/positionId 19):
    // `play.trough` (the position's own worst excursion — `troughDisplay`, adapters.ts:475-480,
    // computed symmetrically alongside `peakDisplay` on every TerminalPlay row, condor-aware) was
    // fully computed and threaded but had ZERO consumers anywhere in src/lib/swing/ — this brief
    // showed "Peak: +161.3%" with no way to know the same position was down -57.2% before it
    // worked. Conviction-relevant history a trade manager would cite ("this one tested you early,
    // don't flinch on the next drawdown scare") that the data already supports; mirrors Peak's own
    // unconditional render (fmtPct handles null as "—" — same convention, both null together when
    // entry/premium data is missing).
    `Trough: **${fmtPct(play.trough)}**`,
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
  // check applies — so `if (play.greeks)` alone is sufficient here; no extra staleness/absence
  // plumbing to duplicate. Formatting matches PlayTerminal.tsx's `fmtGreek` exactly (signed
  // delta/gamma/vega, unsigned theta since a real theta value already carries its own minus sign,
  // iv as a rounded whole-number percent) so a member cross-referencing the deck and Largo never
  // sees the same number rendered two different ways.
  if (play.greeks) {
    const g = play.greeks;
    const sign = (v: number) => (v >= 0 ? "+" : "");
    const parts: string[] = [];
    if (g.delta != null) parts.push(`Δ ${sign(g.delta)}${g.delta.toFixed(2)}`);
    if (g.gamma != null) parts.push(`Γ ${sign(g.gamma)}${g.gamma.toFixed(2)}`);
    if (g.theta != null) parts.push(`θ ${g.theta.toFixed(2)}/day`);
    if (g.vega != null) parts.push(`ν ${sign(g.vega)}${g.vega.toFixed(2)}`);
    if (g.iv != null) parts.push(`IV ${Math.round(g.iv * 100)}%`);
    if (parts.length) lines.push(`Greeks: ${parts.join(" · ")}`);
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
        gate != null
          ? `${spreadLine} — this sub-lane's own entry liquidity bar was **${(gate * 100).toFixed(0)}%**, so current execution is ${spreadPct <= gate ? "still inside" : "now wider than"} it.`
          : spreadLine,
      );
    } else {
      lines.push(`Quote: **${quote}** _(one-sided book — spread not priceable)_`);
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
  if (play.execPnlPct != null) lines.push(`Exec P&L: **${fmtPct(play.execPnlPct)}**`);
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

function watchEntrySection(play: TerminalPlay, readMs: number): RichSection {
  const lines: string[] = [];
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
    lines.push(
      `First flagged **${days} day${days === 1 ? "" : "s"} ago**${play.detectedAt ? ` (${etStampFromIso(play.detectedAt)})` : ""} — still on WATCH, not yet graduated to a real position.`,
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
  // shown while NOT already expired (the EXPIRED badge + `deadPlayReason` below already own that
  // case) and only when a real deadline was resolvable (never fabricated).
  if (!play.watchEntryExpired && play.entryDeadline) {
    const deadlineMs = Date.parse(play.entryDeadline);
    if (Number.isFinite(deadlineMs)) {
      const daysLeft = Math.max(0, Math.ceil((deadlineMs - readMs) / 86_400_000));
      lines.push(
        `Entry window closes **${etStampFromIso(play.entryDeadline)}** (**${daysLeft} day${daysLeft === 1 ? "" : "s"}** left) — stale after that, wait for a fresh setup.`,
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
    const dead = deadPlayReason(play);
    lines.push(
      (dead ? `**Also gate-blocked** (moot — ${dead}):\n` : "**Gates blocking entry:**\n") +
        play.gateBlocks.map((g) => `• ${g.code}: ${g.reason}`).join("\n"),
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
  if (!asOf) return "unknown";
  const observedMs = fundamentalsObservedMs(asOf);
  if (observedMs == null || !Number.isFinite(observedMs)) return "unknown";
  return freshnessFromObservedMs(observedMs, readMs);
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

function levelsFromContext(ctx: SwingPlayBriefContext, readMs: number): BieLevel[] {
  const levels: BieLevel[] = [];
  const vec = ctx.vector ?? ctx.ecosystem?.vector_full_state ?? null;
  const gex = ctx.ecosystem?.gex_positioning;
  const vecFresh = vectorFreshness(vec, readMs);
  const gexFresh = gexFreshness(gex, readMs);
  const gexStale = gexMatrixStale(gex, readMs);
  const vectorStale = vectorSnapshotStale(vec, readMs, ctx.sessionDate);
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
      },
    });
  }
  if (!vectorStale) {
    for (const z of vec?.confluenceZones ?? []) {
      levels.push({
        label: confluenceZoneLabel(z, { callWall, putWall }),
        price: z.center,
        provenance: { source: "Vector", asOf: levelProvenanceAsOf(gex, vec, "vector"), freshness: vecFresh },
      });
    }
    for (const dp of vec?.darkPoolLevels ?? []) {
      levels.push({
        label: "dark pool",
        price: dp.strike,
        provenance: { source: "Vector", asOf: levelProvenanceAsOf(gex, vec, "vector"), freshness: vecFresh },
      });
    }
    // The gamma magnet is narrated prominently in the "Trade manager read" section
    // (magnetCoaching, play-brief-narrative-coaching.ts) as a decision-relevant price ("pull up
    // toward this node"), but was never added to the structured envelope.levels array — anything
    // consuming levels (a "show on chart" follow-up, another Largo surface) had no way to see it.
    if (vec?.magnet?.strike != null) {
      levels.push({
        label: "gamma magnet",
        price: vec.magnet.strike,
        provenance: { source: "Vector", asOf: levelProvenanceAsOf(gex, vec, "vector"), freshness: vecFresh },
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
      },
    });
  }
  if (vec?.maxPain != null && !vectorStale) {
    levels.push({
      label: "max pain",
      price: vec.maxPain,
      provenance: { source: "Vector", asOf: levelProvenanceAsOf(gex, vec, "vector"), freshness: vecFresh },
    });
  }
  return levels.slice(0, 10);
}

function evidenceFromContext(ctx: SwingPlayBriefContext, readMs: number): BieEvidence[] {
  const out: BieEvidence[] = [];
  if (ctx.scanAsOf) {
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
    out.push({
      kind: "fact",
      text: `Option mark as of ${markEt}.`,
      provenance: {
        source: "Swing ledger",
        asOf: markEt,
        freshness: Number.isFinite(markMs) ? freshnessFromObservedMs(markMs, readMs) : "unknown",
      },
    });
  }
  const eco = ctx.ecosystem;
  const gex = eco?.gex_positioning;
  const vec = ctx.vector ?? eco?.vector_full_state ?? null;
  const gexStale = gexMatrixStale(gex, readMs);
  const vectorStale = vectorSnapshotStale(vec, readMs, ctx.sessionDate);
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
      const netM = gex.net_gex / 1e6;
      parts.push(`net GEX ${netM >= 0 ? "+" : ""}${netM.toFixed(1)}M`);
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
      if (wall) {
        parts.push(`nearest wall ${wall.strike.toFixed(2)} (${wall.distance_pts.toFixed(1)} pts)`);
      } else if (gex.flip != null) {
        parts.push(`γ-flip ${gex.flip.toFixed(2)}`);
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
        parts.push(
          `${overlap.sameThemeSameDirection.length} same-direction position${overlap.sameThemeSameDirection.length > 1 ? "s" : ""} in ${describeThemeOverlap(overlap.theme)}`,
        );
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
  if (
    statusBucket(ctx.play) === "open" &&
    ctx.play.entry != null &&
    Number.isFinite(ctx.play.entry)
  ) {
    const ticker = ctx.play.ticker.toUpperCase();
    const siblingCount = ctx.laneRows.filter((r) => {
      if (r.ticker.toUpperCase() !== ticker) return false;
      if (!r.liveStatus) return false;
      if (r.entryPremium == null || !Number.isFinite(r.entryPremium)) return false;
      return Math.abs(r.entryPremium - ctx.play.entry!) > 0.005;
    }).length;
    if (siblingCount > 0) {
      out.push({
        kind: "fact",
        text: `${ticker} carries ${siblingCount + 1} concurrent live position(s) — this brief covers one.`,
        provenance: { source: "Swing ledger", asOf: ctx.asOf, freshness: "recent" },
      });
    }
  }
  return out;
}

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
  base.push(`Open full Largo for ${t}`);
  return base;
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
  const { play } = ctx;
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

  if (bucket === "watch") {
    sections.push(watchEntrySection(play, readMs));
  } else if (bucket === "open") {
    sections.push(managementSection(play));
    const th = thesisHealthSection(play);
    if (th) sections.push(th);
    sections.push(pnlSection(play));
    const siblings = siblingPositionsNote(ctx);
    if (siblings) sections.push(siblings);
  } else {
    sections.push(closedSection(play));
  }

  sections.push(...buildIntelSections(ctx, bucket, { collapseIntel: !opts?.expandIntel }));

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
  const invalidation =
    bucket === "closed"
      ? null
      : play.thesisBreak?.level === "break"
        ? play.thesisBreak.note ?? "Thesis break — structural invalidation fired."
        : dead
          ? `${dead.charAt(0).toUpperCase()}${dead.slice(1)} — this setup is no longer live.`
          : resolveBreakInvalidation(ctx) ??
            play.gateBlocks?.[0]?.reason ??
            (bucket === "open" && play.exitPolicy?.stop_premium != null
              ? `Premium stop at ${fmtUsd(play.exitPolicy.stop_premium)}`
              : null);

  const envelope: BieAnswerEnvelope = {
    ...buildRichEnvelope({
      headline: `${action?.label ?? play.recommendation ?? play.status} — ${headline}`,
      bias: biasFromDirection(play.direction),
      intent: "swing_play_brief",
      sections,
      evidence: evidenceFromContext(ctx, readMs),
      levels: levelsFromContext(ctx, readMs),
      invalidation,
      followups: followupsFor(play),
      unavailableSources: collectBriefUnavailableSources(ctx),
    }),
    asOf: ctx.asOf,
    session_date: ctx.sessionDate,
    // Structure Ladder widget (Ask Largo standing mandate, 2026-09-12) — null on CLOSED plays and
    // on any read with no live spot/structural nodes to build from; never fabricated.
    structureLadder: buildStructureLadder(ctx, play, bucket),
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
    envelope,
    asOf: ctx.asOf,
    sessionDate: ctx.sessionDate,
    engine: "swing_play_intelligence",
    flowSnapshot,
    briefContentKey: briefContentKey(snap),
    trimsFired,
  };
}
