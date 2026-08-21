// Absence labelling for the Vector full-state read.
//
// Side-effect-free (NO `import "server-only"`) so it is unit-testable under `tsx --test`.
//
// WHY THIS EXISTS
// ---------------
// `computeVectorFullState` fans out over the Vector reads and fails open PER FIELD — every one of
// them resolves to `null` rather than throwing. That is the right discipline for the chart, whose
// consumer is a human looking at a canvas: an overlay that cannot be read simply is not drawn, and
// the member sees an absence and reads it as one.
//
// It is a DEFECT at a tool boundary, because the consumer there is a model that turns the payload
// into a sentence. `expectedMove: null` becomes "NVDA has no expected move" — a confident product
// claim — when the truth may be "the chain read failed". The reads themselves cannot tell the two
// apart either: `vector-expected-move-server.ts` returns `null` for "no contracts" (genuinely
// nothing) and from `catch { return null }` (an upstream we could not reach), and by the time the
// composer sees it, both look identical.
//
// So this module does NOT claim a distinction it cannot make. It does the two things that are
// honestly available:
//
//   1. NAME every section that came back absent, so the model knows an absence occurred at all
//      rather than silently answering around it. This is the same device `vector-analytics.ts`
//      already uses ("'we could not read it' and 'it is empty' are different answers and Largo has
//      to be able to tell a member which one it is") — `get_vector_full_state` simply never had it.
//   2. Where a cheap, real distinction DOES exist, make it. The bead rail is the case that matters:
//      an empty `wallHistory` before the open is the recorder working exactly as designed, and
//      reporting it as missing data has already sent one investigation down the wrong path
//      (see docs/audit/VECTOR-BEAD-CADENCE-INVESTIGATION-2026-08-19.md: "Live probe at 00:53 ET
//      returned 0 wall-history samples for SPX/SPY/QQQ/NVDA — expected pre-RTH").

/** The named sections of a Vector full state whose absence is worth reporting. */
export type VectorSection =
  | "gex_walls"
  | "gamma_flip"
  | "max_pain"
  | "expected_move"
  | "ladder"
  | "heatmap"
  | "technicals"
  | "flow_markers"
  | "vex_walls"
  | "dark_pool_levels"
  | "wall_history"
  | "play";

/** Why the bead rail is empty. The RTH distinction is real and cheap; the rest is honest ignorance. */
export type WallHistoryEmptyReason =
  /** Before the open / after the close: the session rail has not been recorded yet. Expected. */
  | "outside_rth_no_recording_yet"
  /** Market is open but this ticker's rail is empty — a genuine gap worth reporting. */
  | "no_samples_during_rth";

export type VectorAbsenceReport = {
  /** Sections that came back absent on this read. Empty array = the whole surface resolved. */
  unavailable_sections: VectorSection[];
  /** Null when the rail has samples. */
  wall_history_empty_reason: WallHistoryEmptyReason | null;
  /**
   * The disclaimer that keeps this honest. An entry in `unavailable_sections` means the section is
   * NOT PRESENT on this read — it does NOT establish that the underlying thing does not exist.
   */
  absence_note: string | null;
};

const ABSENCE_NOTE =
  "A section named in unavailable_sections was not present on this read. That is NOT evidence the " +
  "underlying data does not exist: these reads fail open, so an upstream that could not be reached " +
  "and a genuinely empty result are indistinguishable here. Say the section was unavailable rather " +
  "than asserting the ticker has no such level.";

/** Inputs are the already-resolved sections; `null`/empty means absent. */
export type VectorAbsenceInput = {
  gexWalls: unknown;
  gammaFlip: number | null | undefined;
  maxPain: number | null | undefined;
  expectedMove: unknown;
  ladder: unknown;
  heatmap: unknown;
  technicals: unknown;
  flowMarkers: unknown;
  vexWalls: unknown;
  darkPoolLevels: readonly unknown[] | null | undefined;
  wallHistory: readonly unknown[] | null | undefined;
  play: unknown;
  /** True when the read happened inside cash RTH — the only cheap, real reason-distinction we have. */
  isRth: boolean;
};

export function reportVectorAbsences(input: VectorAbsenceInput): VectorAbsenceReport {
  const missing: VectorSection[] = [];
  const absent = (v: unknown) => v == null;

  if (absent(input.gexWalls)) missing.push("gex_walls");
  if (absent(input.gammaFlip)) missing.push("gamma_flip");
  if (absent(input.maxPain)) missing.push("max_pain");
  if (absent(input.expectedMove)) missing.push("expected_move");
  if (absent(input.ladder)) missing.push("ladder");
  if (absent(input.heatmap)) missing.push("heatmap");
  if (absent(input.technicals)) missing.push("technicals");
  if (absent(input.flowMarkers)) missing.push("flow_markers");
  if (absent(input.vexWalls)) missing.push("vex_walls");
  if (!input.darkPoolLevels?.length) missing.push("dark_pool_levels");
  if (!input.wallHistory?.length) missing.push("wall_history");
  // The play is DERIVED, so its absence means the inputs were too thin to build one — still worth
  // naming, because "no play" reads as "no setup" when it can mean "not enough state to judge".
  if (absent(input.play)) missing.push("play");

  const railEmpty = !input.wallHistory?.length;

  return {
    unavailable_sections: missing,
    wall_history_empty_reason: railEmpty
      ? input.isRth
        ? "no_samples_during_rth"
        : "outside_rth_no_recording_yet"
      : null,
    absence_note: missing.length ? ABSENCE_NOTE : null,
  };
}
