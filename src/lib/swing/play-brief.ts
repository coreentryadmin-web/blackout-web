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
import { buildRichEnvelope, type RichSection } from "@/lib/bie/rich-narrative";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import { playContractHeadline } from "@/features/nighthawk/command-deck/play-card-lifecycle";
import { playGradeLabel, playQualityPct } from "@/features/nighthawk/command-deck/play-card-display";
import { swingActionDisplay } from "@/features/nighthawk/command-deck/play-card-lifecycle";
import { thesisStrengthPct } from "@/features/nighthawk/command-deck/terminal-display";
import type { SwingPlayBriefContext, SwingPlayBriefResult } from "./play-brief-types";
import {
  collectBriefUnavailableSources,
  gexMatrixAgeMs,
  gexMatrixStale,
  playExpectsLiveOptionMark,
  trustedHelixFlow,
  vectorSnapshotStale,
} from "./play-brief-absence";
import { buildIntelSections } from "./play-brief-intel";
import { resolveBreakInvalidation } from "./play-brief-narrative";
import { briefContentKey, extrasFromBriefResponse, snapshotFromBrief } from "./play-brief-diff";
import { fmtPremium } from "@/lib/fmt-money";
import {
  etStampFromDateOrIso,
  etStampFromIso,
  parseEtStamp,
} from "@/lib/largo/temporal/bar-session-date";
import { thesisHealthUncalibrated } from "./thesis-health";

function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

/**
 * Format an ABSOLUTE premium price ($ per contract) — entry, mark, and the exit-policy's
 * stop/target rail levels. All four call sites (below) are prices, never signed deltas, so
 * this must never carry a "+"/"-" prefix.
 *
 * BUG FIXED 2026-09-09 (live repro on NN, position #32): this used to be `n >= 0 ? "+" : ""`,
 * a signed-delta formatter borrowed for an absolute price. A premium price is never negative
 * to begin with, so every open swing brief rendered "Entry: **+$1.95**" / "Mark: **+$1.35**"
 * regardless of whether the position was up or down — and worse, "Rails: stop +$0.78" put a
 * "+" on the STOP-LOSS trigger price, which reads as a gain when hitting it is a ~60% loss.
 * `play-brief-intel.ts` already has the correct sign-free formatter for other absolute price
 * levels (GEX walls, spot); this brings play-brief.ts's copy in line with it.
 */
function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
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
  return {
    title: "Thesis health",
    body: `**${h.health}%** · ${h.rungLabel}\n\n${rows || "Pillars not wired on this row."}`,
    bias: h.health >= 65 ? "bullish" : h.health < 45 ? "bearish" : "neutral",
  };
}

function managementSection(play: TerminalPlay): RichSection {
  const action = swingActionDisplay(play);
  const lines: string[] = [];
  lines.push(`**Recommended:** ${play.recommendation ?? action?.label ?? "HOLD"}`);
  if (play.recNote) lines.push(play.recNote);
  if (play.manageAction) {
    lines.push(`Manage engine: **${play.manageAction}**`);
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
  // path (untouched, markUnsynced is false there).
  const markGenuinelyUnknown = markUnsynced && play.pnlPct == null;
  const lines = [
    `Entry: **${fmtUsd(play.entry)}**`,
    markGenuinelyUnknown
      ? `Mark: **unknown** _(sync quote, no live price yet — do not read as flat)_`
      : markUnsynced
        ? `Mark: **${fmtUsd(play.mark)}** _(live quote, no freshness timestamp)_`
        : `Mark: **${fmtUsd(play.mark)}**${play.markAsOf ? ` (${etStampFromIso(play.markAsOf)})` : ""}`,
    `P&L: **${fmtPct(play.pnlPct)}**${blended != null ? " _(open runner only — trim already banked, see below)_" : ""}`,
    `Peak: **${fmtPct(play.peak)}**`,
  ];
  if (blended != null) {
    lines.push(`Blended P&L (realized trim + open runner): **${fmtPct(blended)}**`);
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
  if (play.gateBlocks?.length) {
    lines.push(
      "**Gates blocking entry:**\n" +
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

function fundamentalsObservedMs(asOf: string): number | null {
  const trimmed = asOf.trim();
  // Date-only anchors at session close ET (Largo C1) — age uses that clock, not UTC midnight.
  const dateOnly = /^(\d{4}-\d{2}-\d{2})$/.exec(trimmed);
  if (dateOnly) return parseEtStamp(`${dateOnly[1]} 16:00 ET`);
  // Full ISO / clocked stamps: preserve sub-minute precision for skew guards (ET round-trip truncates).
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
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
  if (callWall != null && !callWallFromStaleGex) {
    levels.push({
      label: "call wall",
      price: callWall,
      provenance: {
        source: "GEX",
        asOf: levelProvenanceAsOf(gex, vec, gex?.call_wall != null ? "gex" : "vector"),
        freshness: gex?.call_wall != null ? gexFresh : vecFresh,
      },
    });
  }
  if (putWall != null && !putWallFromStaleGex) {
    levels.push({
      label: "put wall",
      price: putWall,
      provenance: {
        source: "GEX",
        asOf: levelProvenanceAsOf(gex, vec, gex?.put_wall != null ? "gex" : "vector"),
        freshness: gex?.put_wall != null ? gexFresh : vecFresh,
      },
    });
  }
  if (flip != null && !flipFromStaleGex) {
    levels.push({
      label: "gamma flip",
      price: flip,
      provenance: {
        source: "GEX",
        asOf: levelProvenanceAsOf(gex, vec, gex?.flip != null ? "gex" : "vector"),
        freshness: gex?.flip != null ? gexFresh : vecFresh,
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
        label: `confluence (${z.kinds.join("+")})`,
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
        asOf: levelProvenanceAsOf(gex, vec, gex?.gex_king_strike != null ? "gex" : "vector"),
        freshness: gex?.gex_king_strike != null ? gexFresh : vecFresh,
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
  const postureFromVec =
    vec?.regime?.posture != null && !vectorStale ? vec.regime.posture : null;
  const postureFromGex = gex?.gamma_posture && !gexStale ? gex.gamma_posture : null;
  const gammaPosture = postureFromVec ?? postureFromGex;
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
  if (play.archetype) verdictLines.push(`Archetype: ${play.archetype}`);
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
  const invalidation =
    play.thesisBreak?.level === "break"
      ? play.thesisBreak.note ?? "Thesis break — structural invalidation fired."
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
