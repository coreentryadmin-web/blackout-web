import type { BieAnswerEnvelope } from "@/lib/bie/answer-envelope";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import type { EcosystemContext } from "@/lib/bie/ecosystem-context";
import type { VectorFullState } from "@/lib/bie/vector-full-state";
import type { HorizonPlay } from "@/lib/horizon-plays";
import type { SwingMeridianCatalystSlice } from "./play-brief-meridian";
import type { SwingMeridianPeerSlice } from "./play-brief-meridian-peer-core";
import type { PortfolioPosition } from "./portfolio";
import type { SwingArchetypeTrackRecordSnapshot } from "./calibration-cache";
import type { SwingChainComposite } from "./record";
import type { SwingTickerTrackRecord } from "./play-brief-ticker-history";

/** Inputs gathered server-side for deterministic swing play brief composition. */
export type SwingPlayBriefContext = {
  play: TerminalPlay;
  asOf: string;
  /** ET session date for the brief stamp (YYYY-MM-DD). */
  sessionDate: string | null;
  scanAsOf: string | null;
  ecosystem: EcosystemContext | null;
  vector: VectorFullState | null;
  /** ET session day for the swing discovery scan, when known. */
  scanSessionDay: string | null;
  /** Full serving-lane rows for comparative rank. */
  laneRows: HorizonPlay[];
  /** Meridian catalyst calendar slice for this ticker. */
  meridian: SwingMeridianCatalystSlice | null;
  /** Sector peer earnings cohort when an earnings catalyst is within 14d. */
  meridianPeer?: SwingMeridianPeerSlice | null;
  /**
   * The member's OTHER open swing positions (this play excluded) — feeds the
   * "Book context" theme-overlap section. Empty array when there are none;
   * `null` when the ledger read failed; `undefined` only in fixtures that predate
   * this field (treated as "unknown", not "none").
   */
  openBook?: PortfolioPosition[] | null;
  /**
   * True when the `fetchEcosystemContext`/`fetchVectorFullState` call itself threw (network,
   * timeout, provider error) rather than legitimately returning nothing. `ecosystem`/`vector`
   * being `null` is otherwise ambiguous between "fetch failed" and "no data to report" — the same
   * distinction `openBook: null` already carries. FINDINGS 2026-09-06 (#11).
   */
  ecosystemFetchFailed?: boolean;
  vectorFetchFailed?: boolean;
  /**
   * The distilled per-archetype/sub-lane graduation snapshot (calibration-cache.ts) — feeds the
   * "Track record" section's ONLY-WHEN-GRADUATED citation (Largo C10 historical context). `null`
   * on a cold cache, a timed-out read, or a persistence failure on the writer side; `undefined`
   * only in fixtures that predate this field (treated identically to `null` — "no citation this
   * cycle", never an error). Optional/best-effort by design: the brief must compose the same
   * whether this landed or not.
   */
  archetypeTrackRecord?: SwingArchetypeTrackRecordSnapshot | null;
  /**
   * Roll history for the chain backing this play (record.ts's `roll_seq` thread) — feeds the
   * narrative's "rolled N times" disclosure. `null` when the position has never been rolled, the
   * ledger read failed, or the play carries no `positionId` (a WATCH/lane-only candidate has no
   * ledger row at all). `undefined` only in fixtures predating this field (treated as "unknown",
   * never fabricated as "never rolled").
   */
  rollHistory?: SwingRollHistory | null;
  /**
   * Ticker-scoped historical context (Largo C10) — "has the desk traded THIS ticker before, and
   * how did it go" — distinct from `archetypeTrackRecord` above, which is scoped to the
   * ARCHETYPE dimension, not the ticker (see play-brief-ticker-history.ts's file header for the
   * exact gap this closes). `null` on a cold/failed read or when there is no resolved prior trade
   * to cite; `undefined` only in fixtures predating this field (treated identically to `null`).
   */
  tickerTrackRecord?: SwingTickerTrackRecord | null;
  /**
   * Single canonical "now" (epoch ms) for every Vector/GEX staleness check this brief's compose
   * performs — stamped ONCE by `composeSwingPlayBrief` before any section is built. Optional so
   * every existing fixture/test that predates this field keeps working (each staleness helper
   * still falls back to its own `Date.now()` when this is absent).
   *
   * BUG FIX (Ask Largo standing mandate, 2026-09-21): before this field existed, every one of the
   * ~20 `vectorSnapshotStale(vec, Date.now(), ...)`/`gexMatrixStale(..., Date.now())` call sites
   * spread across play-brief.ts/play-brief-intel.ts/play-brief-narrative.ts/
   * play-brief-narrative-coaching.ts sampled the wall clock independently, at whatever instant
   * that particular section happened to compose (compose does real sequential I/O — Meridian,
   * book-context, archetype-track-record reads — between sections, so these instants can be
   * seconds apart within one request). When the underlying Vector snapshot's age sits near the
   * 120s `VECTOR_STALE_MS` cutoff, two sections reading the exact SAME cached `vec` object could
   * land on OPPOSITE sides of the boundary and silently disagree — one renders the live Vector
   * wall, the other falls back to the (different) GEX-matrix number — with no indication to the
   * trader that two different data sources answered what reads as one fact. Live repro 2026-09-21
   * (SNXX committed brief): "Trade manager read"'s `confluenceCoaching` bullet ("Confluence 15.50
   * (put-wall@15.5 ...)") disagreed with "What to watch"'s `watchForSection` ("Structural support
   * node: put wall 10.00") in the SAME envelope — both trace back to `vec.gexWalls.putWalls[0]`,
   * but one call evaluated the snapshot as live and the other as stale. Only `confluenceCoaching`
   * and `watchForSection` (the two call sites this live repro actually exercised) are wired to
   * this anchor so far; the other ~18 `Date.now()` call sites are the same class of latent risk
   * and a natural next sweep, left as a documented follow-up rather than folded into this fix.
   */
  readMs?: number | null;
};

/** One leg's identity for the roll-history narrative — deliberately minimal (no P&L; the
 *  narrative discloses WHAT was rolled, not how it graded — the chain composite already owns
 *  P&L semantics per record.ts). */
export type SwingRollHistoryLeg = {
  rollSeq: number;
  strike: number | null;
  right: string | null;
  expiry: string | null;
  /** ISO timestamp this leg was committed — the roll date for every leg after the first. */
  committedAt: string | null;
};

export type SwingRollHistory = {
  /** Number of rolls in the chain — `chain.length - 1`. Only present (and only ever cited) when > 0. */
  rollCount: number;
  /** Full chain oldest→newest by roll_seq, mirroring fetchSwingPositionChain's own order. */
  legs: SwingRollHistoryLeg[];
  /**
   * The chain's real composite outcome (record.ts's `buildSwingRecord(chain).composite` — the SAME
   * function/call the Closed-tab list view and /api/market/swing/record use, never recomputed here).
   * Present only once the chain has actually closed (`chainResolved`); a still-rolling chain has this
   * `null` rather than a premature composite. Found 2026-09-15 (Ask Largo mandate, live repro
   * INTC:35): the play-brief's own headline P&L is deliberately the TERMINAL LEG's own exit P&L, not
   * this composite (play-brief-resolve.ts's `loadClosedPlay` — protects against the exact
   * peak/composite-mismatch bug closed-plays.ts's own header documents), so a rolled chain's REAL
   * result (which can be materially worse — INTC: terminal leg -33.2% vs composite -60.47%
   * compounded) was otherwise never visible anywhere in the brief. This field feeds ONE additional
   * reference line (`rollHistoryLine`) — deliberately never blended with the terminal leg's own
   * price/peak/trough fields, which is exactly what caused the original bug.
   */
  chainComposite: SwingChainComposite | null;
};

export type SwingPlayBriefResult = {
  playId: string;
  ticker: string;
  envelope: BieAnswerEnvelope;
  asOf: string;
  /** ET session date (YYYY-MM-DD) for the brief read — Largo C1 join key. */
  sessionDate: string | null;
  /** Deterministic — no Anthropic spend. */
  engine: "swing_play_intelligence";
  /**
   * HELIX flow premiums for this cycle, split out as an explicit typed field rather than folded
   * into `envelope.levels` — the "what changed" diff engine (play-brief-diff.ts) needs these as
   * numbers to detect a call/put flow shift between polls, and a `BieLevel` (a chart price level)
   * is the wrong shape for a dollar premium total. null when HELIX has no recent-flow read.
   */
  flowSnapshot: { callPremium: number | null; putPremium: number | null } | null;
  /** Stable dedupe key for client refresh — excludes time-only fields. */
  briefContentKey: string;
  /** Count of fired trim rails at compose time. */
  trimsFired: number | null;
};
