/**
 * CAPTURE LESSONS — the playbook, in a form the pipeline can read.
 *
 * ── WHY THIS FILE EXISTS ALONGSIDE THE MARKDOWN ────────────────────────────────────────────────
 *
 * `content/Screenshot-Playbook.md` is the living document a human reads and edits. This is the
 * subset a MACHINE needs, because a playbook nothing consults is documentation, not behaviour —
 * the exact defect class this fleet keeps finding: a fact that exists in the system and is not
 * wired to the rule that needs it.
 *
 * The two must not drift, so `capture-lessons.test.ts` asserts every lesson here names a real
 * catalog view or surface, and the markdown carries the prose the tests cannot check.
 *
 * ── THE EVIDENCE TAG IS LOAD-BEARING ───────────────────────────────────────────────────────────
 *
 * Every lesson declares how it is known. `MEASURED` was observed and the observation is recorded.
 * `RULED` came from the operator and binds regardless of measurement. `HYPOTHESIS` is a plausible
 * belief with NO data behind it, and `sample_size` says so out loud.
 *
 * As of 2026-08-21 every engagement belief is a HYPOTHESIS at n = 0, because nothing from this
 * pipeline has been published. Promoting one to MEASURED without a real denominator would be
 * fabricating a finding — the same failure as an invented confidence score, and it would then be
 * compared against measurements that are real.
 */

export type LessonEvidence = "MEASURED" | "RULED" | "HYPOTHESIS";

export type CaptureLesson = {
  id: string;
  /** Catalog view id, surface name, or "*" for a cross-cutting rule. */
  applies_to: string;
  evidence: LessonEvidence;
  /** Null for RULED and for HYPOTHESIS-at-zero. A number only when something was counted. */
  sample_size: number | null;
  lesson: string;
  /** What was actually observed. Required for MEASURED — a measurement with no observation is a claim. */
  observation?: string;
};

export const CAPTURE_LESSONS: ReadonlyArray<CaptureLesson> = [
  {
    id: "default-view-is-not-honest-view",
    applies_to: "*",
    evidence: "MEASURED",
    sample_size: 1,
    lesson:
      "For any product with a scope or filter default, check whether the default changes the CLAIM, not just the framing. Assert the control took; never click and hope.",
    observation:
      "SPY 2026-08-21: front-expiry default read LONG GAMMA / NET GEX -$1.8B; expiry ALL read SHORT GAMMA at every strike / -$7.6B. Opposite regimes from the same page.",
  },
  {
    id: "right-number-wrong-horizon",
    applies_to: "thermal",
    evidence: "MEASURED",
    sample_size: 1,
    lesson:
      "An accurate transcription of the WRONG SCOPE is still a false claim. Capture ALL (the operator's rule), but name the horizon of every level that reaches copy, and build a session claim on the near-dated read.",
    observation:
      "SPX 2026-08-21 06:05-06:32 ET: ALL read SHORT GAMMA / call wall 7,900 / vol EXPANDED / no flip; 0DTE read LONG GAMMA / call wall 7,700 / vol SUPPRESSED / flip 7,633. Opposite stories, same ticker, same morning. A draft quoting the ALL figures told readers hedging would amplify a move on a session whose 0DTE book says dealers are stabilizing.",
  },
  {
    id: "frame-level-before-crop",
    applies_to: "*",
    evidence: "MEASURED",
    sample_size: 2,
    lesson:
      "Choose the container first, crop second. A frame chosen at the wrong level cannot be rescued by cropping.",
    observation:
      "`.meridian-page-root` measured 14,704px tall; and a Vector `.vector-chart-wrap` crop dropped the toolbar the operator wanted in frame.",
  },
  {
    id: "judge-at-timeline-size",
    applies_to: "vector.desk",
    evidence: "MEASURED",
    sample_size: 1,
    lesson:
      "Judge every frame at the size a phone renders it. Zoom that looks fine at full resolution can fail at timeline size.",
    observation:
      "SPX 0DTE capture at zoom=7: gamma beads ran together into a continuous smear rather than countable marks.",
  },
  {
    id: "chrome-is-fixed-position",
    applies_to: "*",
    evidence: "MEASURED",
    sample_size: 1,
    lesson:
      "Remove marketing chrome from the layer, do not crop it. It is position:fixed, so it floats over the desk container and lands inside an element screenshot anyway.",
    observation:
      "First Thermal Semis grid capture: nav bled across the top of a `.gex-heatmap-desk` element screenshot.",
  },
  {
    id: "park-the-pointer",
    applies_to: "vector.desk",
    evidence: "MEASURED",
    sample_size: 1,
    lesson: "Move the pointer off-chart before the shutter fires — zoom leaves a crosshair readout over the frame.",
    observation: "SPX zoom capture carried a '2:30:00 PM GEX SPX 7,653' tooltip over the top-left of the frame.",
  },
  {
    id: "thermal-expiry-all",
    applies_to: "thermal",
    evidence: "RULED",
    sample_size: null,
    lesson:
      "Thermal is always captured on the ALL expiry filter. Lens is free (GEX/VEX/DEX/CHARM); expiry scope is not. Set it on MATRIX before switching tabs — FORCED FLOW has no expiry bar.",
  },
  {
    id: "helix-filters-are-evidence",
    applies_to: "helix",
    evidence: "RULED",
    sample_size: null,
    lesson:
      "The Helix filter row is visible in frame, so it is part of the evidence. Vary FLOOR / SIDE / DTE / QUICK per post and set them to match the claim being made.",
  },
  {
    id: "helix-top-strikes-beats-tape",
    applies_to: "helix.top_strikes",
    evidence: "RULED",
    sample_size: null,
    lesson:
      "For a whale story, TOP STRIKES beats the raw tape: it shows repetition and direction, which is the actual claim. One sweep is noise; repeated fills at one strike is a thesis.",
  },
  {
    id: "vector-separate-the-beads",
    applies_to: "vector",
    evidence: "RULED",
    sample_size: null,
    lesson:
      "Zoom until candles, beads and wall bands are SEPARATELY legible — a reader must be able to count the beads without pinching. 'The chart rendered' is not the bar.",
  },
  {
    id: "vector-vary-controls",
    applies_to: "vector",
    evidence: "RULED",
    sample_size: null,
    lesson:
      "Vary horizon, lens, timeframe, indicators and node density per post — not just the ticker. Carry the surrounding intel rails, not the bare chart.",
  },
  {
    id: "nighthawk-pnl-gate",
    applies_to: "nighthawk",
    evidence: "RULED",
    sample_size: null,
    lesson:
      "Post Night Hawk only for a closed play above +50% on a session that did not finish red. Frame the winning stack, and state the session's TOTAL play count so the denominator is visible.",
  },
  {
    id: "meridian-panel-not-page",
    applies_to: "meridian",
    evidence: "MEASURED",
    sample_size: 1,
    lesson:
      "Frame a labelled Meridian panel or `.meridian-detail`, never the page root. The per-event tabs are the rich frames; the analytics-grid panels are thin strips best used as a confirmation slot.",
    observation:
      "Analytics-grid panels measured ~95-121px tall; `.meridian-page-root` measured 14,704px.",
  },
  {
    id: "meridian-select-by-theme",
    applies_to: "meridian",
    evidence: "MEASURED",
    sample_size: 1,
    lesson:
      "Select a Meridian event by its theme class, not by position — the timeline mixes earnings, macro, FDA and OpEx rows.",
    observation:
      "Already recorded in meridian-earnings-ui-audit.mjs; re-confirmed when the macro filter opened US Flash Services PMI rather than an earnings row.",
  },
  {
    id: "closed-market-is-weak-evidence",
    applies_to: "*",
    evidence: "MEASURED",
    sample_size: 1,
    lesson:
      "Market-closed captures prove the harness works but are weak evidence of a move. Helix reads FLOW UNAVAILABLE, Night Hawk shows zero plays, chart candles are thin.",
    observation: "05:00-05:30 ET 2026-08-21 across Helix, Night Hawk, Vector and Thermal.",
  },
  {
    id: "wait-read-is-publishable",
    applies_to: "largo.answer",
    evidence: "RULED",
    sample_size: null,
    lesson:
      "A NEUTRAL / WAIT read is publishable content, not a failed capture. Credibility compounds; forcing a directional call on a two-sided tape does not.",
  },

  // ── ENGAGEMENT BELIEFS — every one of these is n = 0 ──────────────────────────────────────
  {
    id: "h-closeups-beat-full-pages",
    applies_to: "*",
    evidence: "HYPOTHESIS",
    sample_size: 0,
    lesson:
      "Close-up frames with one clear focal point may outperform full-desk screenshots. UNTESTED — no package has been published.",
  },
  {
    id: "h-cross-product-beats-single",
    applies_to: "*",
    evidence: "HYPOTHESIS",
    sample_size: 0,
    lesson:
      "Cross-product carousels may outperform single-product posts because they demonstrate the network rather than one feature. UNTESTED.",
  },
  {
    id: "h-timeline-drives-signups",
    applies_to: "nighthawk.timeline",
    evidence: "HYPOTHESIS",
    sample_size: 0,
    lesson:
      "Night Hawk timelines may drive signups more than P&L screenshots, because a timestamped sequence is harder to fake than a number. UNTESTED.",
  },
];

/** Lessons that bind for a given catalog view or surface, most-binding first. */
export function lessonsFor(target: string): CaptureLesson[] {
  const rank: Record<LessonEvidence, number> = { RULED: 0, MEASURED: 1, HYPOTHESIS: 2 };
  return CAPTURE_LESSONS.filter(
    (l) => l.applies_to === "*" || l.applies_to === target || target.startsWith(`${l.applies_to}.`),
  ).sort((a, b) => rank[a.evidence] - rank[b.evidence]);
}

/**
 * Whether a lesson may be cited as a reason in a queue row's `reason_selected`.
 *
 * A HYPOTHESIS may guide a choice but must never be written down as though it justified one — that
 * is how an untested belief becomes institutional fact without anyone deciding it should.
 */
export function isCitable(lesson: CaptureLesson): boolean {
  return lesson.evidence !== "HYPOTHESIS";
}
