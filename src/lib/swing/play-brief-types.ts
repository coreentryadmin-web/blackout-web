import type { BieAnswerEnvelope } from "@/lib/bie/answer-envelope";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import type { EcosystemContext } from "@/lib/bie/ecosystem-context";
import type { VectorFullState } from "@/lib/bie/vector-full-state";
import type { HorizonPlay } from "@/lib/horizon-plays";
import type { SwingMeridianCatalystSlice } from "./play-brief-meridian";
import type { SwingMeridianPeerSlice } from "./play-brief-meridian-peer-core";
import type { PortfolioPosition } from "./portfolio";

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
};

export type SwingPlayBriefResult = {
  playId: string;
  ticker: string;
  envelope: BieAnswerEnvelope;
  asOf: string;
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
