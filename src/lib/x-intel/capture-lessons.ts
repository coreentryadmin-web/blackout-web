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
    id: "platform-finds-stories-for-you",
    applies_to: "*",
    evidence: "MEASURED",
    sample_size: 1,
    lesson:
      "Start a cycle at the Vector Universe Scanner and the Helix Net Premium Leaderboard, not by browsing seven products. They RANK the market by actionability and by where premium is going, so the candidate list arrives pre-sorted.",
    observation:
      "Vector scanner 'Nearest flip' at 06:45 ET 2026-08-21 returned TSLA on its flip exactly (349.20 vs 349.20, call wall 350), then SMCI -0.1%, RIOT +0.1%, MU -0.3% — a ranked story queue before opening a single chart. The scanner's own hint calls this preset 'most actionable'.",
  },
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
    id: "scanner-finds-stories-but-is-a-poor-attachment",
    applies_to: "vector",
    evidence: "MEASURED",
    sample_size: 1,
    lesson:
      "The Universe Scanner is a story-FINDING tool, not a lead attachment. Finding and showing are different jobs. If a ranking must be shown, crop to ~6 rows and use it as a confirmation slot.",
    observation:
      "A 14-row scanner crop measured 4.89:1 with timeline legibility 0.43 — a letterboxed strip whose numbers cannot be read without tapping. I had praised it as postable before measuring it.",
  },
  {
    id: "measure-frames-do-not-judge-them",
    applies_to: "*",
    evidence: "MEASURED",
    sample_size: 10,
    lesson:
      "Run `x-intel-frame-quality.mjs` on every candidate frame. A reject list applied by eye is applied by whoever remembers to apply it, and full-resolution review cannot see what collapses at phone size.",
    observation:
      "Scored 10 frames captured 2026-08-21: 7 pass, 3 reject. The operator-approved Vector zoom scored highest on timeline legibility (0.88) without the metric being tuned for it; the first version of the metric passed all nine inputs, which meant it was broken rather than lenient.",
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
  {
    id: "vector-axis-is-utc",
    applies_to: "vector",
    evidence: "MEASURED",
    sample_size: 2,
    lesson:
      "The Vector chart's time axis is UTC, not ET. Convert before any time reaches copy. Reading it as ET moves every event four hours earlier and turns a premarket print into a session one — the exact error class that put a far-dated call wall into a 0DTE sentence.",
    observation:
      "NVDA 2026-08-21, captured 15:07-15:09 UTC / 11:07-11:09 ET. Two independent anchors put the axis in UTC: the previous session's closing volume spike sits at '20:00' (16:00 ET close) and today's opening spike at '13:30' (09:30 ET open), and the right edge lands just past 14:00 with roughly an hour of candles beyond it, matching a 15:08 UTC capture. A zoomed frame from the same run showed a flush at '09:00' that a first reading called the open; it is 05:00 ET premarket.",
  },
  {
    id: "spot-is-not-the-last-visible-candle",
    applies_to: "vector",
    evidence: "MEASURED",
    sample_size: 5,
    lesson:
      "Read spot from the regime banner or the price tag, never from where the candles happen to stop. A zoomed or scrolled frame ends wherever the viewport ends, which is not the latest bar.",
    observation:
      "NVDA 2026-08-21: five zoomed captures showed rightmost candles at 216.30-217.84 while the banner read 214.89-215.26. The banner was right — /v2/last/trade/NVDA returned 215.2659 at 11:04:41 ET and the Thermal header read 215.05 at 11:01:05 ET. At full fit the chart's own price tag read 215.12, agreeing with its banner. The disagreement was the zoom, not the data.",
  },
  {
    id: "vector-toolbar-renders-twice",
    applies_to: "vector",
    evidence: "MEASURED",
    sample_size: 1,
    lesson:
      "Address desk controls with a visible-only locator. The responsive toolbars render a compact and a wide copy of every control and collapse the unused one to a zero-size box instead of unmounting it, so the first match can be a control that is impossible to click.",
    observation:
      "/vector?ticker=NVDA at 2560x1440: two nodes carry data-testid=\"vector-indicator-trigger\". Copy 0 has rect [0,0,0,0] and elementFromPoint at its origin returns the nav; copy 1 has rect [570,89,116,32] and hit-tests to itself. Playwright reported the first as an 8s click timeout, which read as a broken button for a day and blocked the Indicators menu and FULL SCREEN alike.",
  },
  {
    id: "state-before-view",
    applies_to: "*",
    evidence: "MEASURED",
    sample_size: 2,
    lesson:
      "Set the state that lives on the base view BEFORE switching the view. Doing it the other way loses the state, the framing, or both.",
    observation:
      "Vector: entering full screen and then opening the Indicators menu dropped the chart from 2512x1354 to 1196x1398 portrait in an otherwise identical run. Thermal: FORCED FLOW (DEPTH) renders no expiry bar at all, so ALL has to be set on MATRIX first.",
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
