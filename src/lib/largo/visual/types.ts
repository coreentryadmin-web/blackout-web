/**
 * LARGO VISUAL INTELLIGENCE — the data contracts.
 *
 * THE ONE RULE THIS FILE EXISTS TO ENFORCE: a visual is a RENDERING OF EVIDENCE, never a source of
 * it. Every field below is optional and nullable, and every consumer treats absent as "omit the
 * component" — never as zero, never as a placeholder, never as a reason to invent. A marketing
 * graphic is the single highest-consequence surface this platform has: it outlives the session,
 * it travels without its context, and nobody who sees it can check it. So the type system is the
 * first line of defence, and `VisualNumber` is the shape that carries a value together with where
 * it came from.
 *
 * NO PARALLEL DATA STRUCTURES. Every value here is lifted from a contract that already exists —
 * `BieAnswerEnvelope`, the 0DTE ledger row, `getGexPositioning`'s payload, the flow tape. This
 * module defines the RENDER shape, not a second version of the truth.
 */

/** Output surfaces. Dimensions are the platform's native export sizes. */
export type VisualSize = "x_landscape" | "x_portrait" | "square" | "story";

/** The template library. Three are implemented; the rest are registered but not yet built, and
 *  the router will never select an unimplemented one (see `router.ts`). */
export type VisualTemplateId =
  | "MARKET_MOVE"
  | "COMPOSED"
  | "PLAYBOOK"
  | "TRADE_RECAP"
  | "LEVEL_ANALYSIS"
  | "GAMMA_MAP"
  | "FLOW_RECAP"
  | "TRADE_LEADERBOARD"
  | "SYSTEM_COMPARISON"
  | "BEFORE_AFTER"
  | "SESSION_RECAP"
  | "SIGNAL_TIMELINE"
  | "SCREENER"
  | "REJECTION"
  | "EM_CONE"
  | "COUNTERFACTUAL"
  | "GRADER_AGREEMENT";

/** Which product measured a value — drives the attribution strip and the manifest. */
export type VisualSystem =
  | "THERMAL"
  | "HELIX"
  | "VECTOR"
  | "SPX SLAYER"
  | "NIGHT HAWK"
  | "0DTE"
  | "LARGO";

/**
 * A number with its provenance attached.
 *
 * The `source` is not decoration: it is what makes the manifest an audit trail rather than a list
 * of numbers, and it is what lets a reviewer answer "where did 7,764.93 come from" months later
 * without re-deriving it. A number that cannot name its source does not belong on a card.
 */
export type VisualNumber = {
  value: number;
  /** Pre-formatted for display. Formatting happens ONCE, at bundle time, so the card and the
   *  manifest can never disagree about what was shown. */
  display: string;
  source: VisualSystem;
  /** ISO instant the value was measured, when the source reports one. */
  asOf?: string | null;
};

/** A labelled level on a price map. `kind` drives colour, never the raw sign of a delta. */
export type VisualLevel = {
  label: string;
  price: number;
  display: string;
  kind: "resistance" | "support" | "pivot" | "spot" | "strike" | "level";
  source: VisualSystem;
  /** Signed distance from spot in percent, pre-formatted (true minus sign). */
  distance?: string | null;
  /** Whether price interacted with this level, when the data supports the claim. */
  status?: "held" | "broke" | "untested" | null;
};

/** One step in a trade or session lifecycle. Every step needs a real timestamp. */
export type VisualTimelineStep = {
  label: string;
  /** ET clock, pre-formatted (e.g. "10:02"). */
  time: string;
  detail?: string | null;
  tone?: "neutral" | "positive" | "negative" | "caution";
};

/** A metric tile. */
export type VisualMetric = {
  label: string;
  value: string;
  tone?: "neutral" | "positive" | "negative" | "caution" | "info";
  /** Small line under the value — units, comparison, or the measurement window. */
  sub?: string | null;
  source: VisualSystem;
  /** What this tile ASSERTS — see `VisualFact`. */
  fact?: VisualFact;
};

/**
 * A FACT the card can assert, tagged wherever it is rendered.
 *
 * Several blocks legitimately carry the same underlying number: the dealer posture is the regime
 * block's whole subject, one row of the consensus strip, AND a metric tile. Each is a reasonable
 * way to show it and none of them knew about the others, so a live NVDA card drew the gamma
 * posture three times and the net premium three times — which reads as a data error rather than
 * as emphasis, and spends canvas that had real unshown evidence waiting for it.
 *
 * The tag is what lets the composer keep exactly one rendering of each fact. It is deliberately
 * about the FACT, not the block: a new block that happens to show dealer posture inherits the
 * de-duplication by tagging itself, rather than by being added to a list somewhere else.
 */
export type VisualFact = "gamma_posture" | "net_premium" | "session_change";

/** A directional read from one product, for the attribution strip. */
export type VisualSystemRead = {
  system: VisualSystem;
  stance: "bullish" | "bearish" | "neutral" | "no-read" | "regime";
  detail?: string | null;
  /** What this row ASSERTS — see `VisualFact`. */
  fact?: VisualFact;
};

/**
 * THE EVIDENCE BUNDLE — everything a template may draw, assembled ONCE from the turn that
 * produced the written answer.
 *
 * Assembled from the SAME `capturedResults` the answer was written from, so the graphic and the
 * prose are two renderings of one snapshot. Re-querying to fill a card would let the two disagree
 * about a number while both were individually "correct", which is the worst possible failure on a
 * surface nobody can fact-check.
 */
export type VisualBundle = {
  /** Instrument this visual is about, when there is one. */
  ticker?: string | null;
  /** The card's single conclusion. Comes from the answer's own verdict — never re-generated. */
  headline?: string | null;
  /** One-line explanation under the headline. */
  summary?: string | null;
  bias?: "bull" | "bear" | "neutral" | null;

  spot?: VisualNumber | null;
  /** Session change, when the source supplies it. */
  change?: { absolute: VisualNumber; percent: VisualNumber } | null;

  levels?: VisualLevel[];
  metrics?: VisualMetric[];
  timeline?: VisualTimelineStep[];
  systemReads?: VisualSystemRead[];

  /** Strike-level dealer-gamma changes, from the tool's own output. */
  gexShifts?: { strike: number; change: number; display: string; direction: "stronger" | "weaker" | "flipped" }[];

  /** Dealer regime, verbatim from the positioning read — never inferred from a sign here. */
  regime?: { label: string; detail?: string | null; source: VisualSystem } | null;

  /**
   * PLAYBOOK — the forward runbook: every published play with its entry, target, stop and expiry.
   *
   * A PLAN IS NOT A TRADE, AND CONFLATING THEM IS WHAT THIS BLOCK EXISTS TO FIX. Asked for
   * tomorrow's Night Hawk plays, the router picked TRADE_RECAP and drew ONE ticker carrying one
   * number — `$13.35` alone on a 1080×1920 canvas. Two independent causes, both structural:
   *
   *   1. `trade` is SINGULAR, and the bundle took `findLedgerRows(results)[0]`. Four of the five
   *      published plays were discarded with no note anywhere that they had existed.
   *   2. An edition play carries `entry_range` / `target` / `stop` / `options_play` / `thesis`.
   *      TRADE_RECAP reads `last_mark` / `live_pnl_pct` / `exit_pnl_pct` / `status`. None of those
   *      exist on a play that has not been taken yet, so every field but the entry resolved null
   *      and the card rendered its own skeleton.
   *
   * The member had asked a perfectly reasonable question and the library had no card for it.
   *
   * TWO FIELDS HERE ARE SAFETY-CRITICAL, not presentational:
   *   - `pulled` — the morning confirmation INVALIDATED this play. `types.ts` on `PlaybookPlay`
   *     is explicit that a pulled play is "never hidden, never deleted", and a runbook that
   *     quietly drops one is instructing a member into a trade the system publicly withdrew. It
   *     renders, struck through, with its reason.
   *   - `gatePromoted` — promoted into the edition despite not clearing the publish gates, because
   *     the pipeline would otherwise publish nothing. It must be badged.
   */
  playbook?: {
    /** e.g. "2026-08-11" — the session these plays are FOR, not when they were built. */
    editionFor: string | null;
    publishedAt: string | null;
    /** Total published, so a truncated card can never imply it is showing all of them. */
    totalPlays: number;
    /** True when a real edition published with zero plays — a distinct state from "no edition". */
    noPlays?: boolean;
    /** Served from an older edition because this session's is not published yet. Must be shown. */
    stale?: boolean;
    /** Came from a degraded/legacy source rather than the first-class pipeline. Must be shown. */
    degraded?: boolean;
    rows: {
      rank: number;
      ticker: string;
      direction: "long" | "short";
      conviction: string | null;
      /** Verbatim engine strings — never reformatted, never recomputed here. */
      entryRange: string | null;
      target: string | null;
      stop: string | null;
      optionsPlay: string | null;
      entryPremium: number | null;
      entryPremiumDisplay: string | null;
      thesis: string | null;
      keySignal: string | null;
      rrRatio: number | null;
      /** How far the target sits from the fill edge in ATR units — the gate's own pinned value. */
      targetAtrMultiple: number | null;
      earningsRisk?: boolean;
      pulled?: boolean;
      pulledReason?: string | null;
      gatePromoted?: boolean;
    }[];
    source: VisualSystem;
  } | null;

  /**
   * GENERIC BLOCKS — anything the purpose-built extractors did not claim.
   *
   * MEASURED COVERAGE GAP: `bundle.ts` carried SEVEN shape-matchers against 121 callable tools.
   * Earnings and IPO and FDA calendars, financials, ownership, congress and insider flow, analyst
   * ratings, IV term structure, realized vol, skew, breadth, movers, hot tickers, sector flow, OI
   * per strike and expiry, max pain, NOPE, technicals, seasonality, relative strength, setup stats
   * and trade history all produced output that reached NO block — so a question answered from six
   * uncatalogued tools composed a headline and a spot and then ran out of things to draw.
   *
   * That is the whole explanation for the empty canvas: a composer can only pack blocks that
   * exist. See `generic-extract.ts` for why these are three generic shapes rather than a hundred
   * bespoke ones, and for the six rules that stop structural inference becoming fabrication.
   */
  genericStats?: { title: string; rows: { label: string; value: string }[]; source: VisualSystem } | null;
  genericRanked?: { title: string; rows: { label: string; value: string; magnitude: number; sub?: string | null }[]; source: VisualSystem } | null;
  genericEvents?: { title: string; rows: { when: string; label: string; detail?: string | null }[]; source: VisualSystem } | null;

  /** Trade lifecycle, for TRADE_RECAP. */
  trade?: {
    ticker: string;
    direction: "long" | "short";
    contract?: string | null;
    entry?: VisualNumber | null;
    exit?: VisualNumber | null;
    peak?: VisualNumber | null;
    returnPct?: VisualNumber | null;
    peakReturnPct?: VisualNumber | null;
    status?: string | null;
    /** Present ONLY when the row is officially graded. An ungraded row renders as OPEN, never as
     *  a result — the record-honesty rule, applied to the marketing surface. */
    graded?: boolean;
    outcome?: string | null;
    source: VisualSystem;
  } | null;

  /** SCREENER — a ranked slice of the universe. `rows` is already ordered; the card does not
   *  re-sort, because the ORDER is the claim being made. */
  screen?: {
    preset: string;
    metricLabel: string;
    universeSize: number;
    updatedAt: string | null;
    rows: {
      ticker: string;
      metricValue: number;
      metricDisplay: string;
      regime: "above" | "below" | "unknown";
    }[];
  } | null;

  /** REJECTION — gate-held setups, in log order. Never a caller-curated subset. */
  rejections?: {
    total: number;
    windowLabel: string | null;
    rows: { ticker: string; gateFailed: string; reason?: string | null; at?: string | null }[];
  } | null;

  /** EM_CONE — an options-implied band plus the REALISED path through it. Post-close only. */
  cone?: {
    upper: number;
    lower: number;
    upperDisplay: string;
    lowerDisplay: string;
    widthDisplay: string;
    openDisplay: string;
    closeDisplay: string;
    sigmaLabel: string;
    /** held = never left · breached = left and returned · closed_outside = ended beyond. */
    verdict: "held" | "breached" | "closed_outside";
    path: { price: number }[];
    asOf: string | null;
  } | null;

  /**
   * GAMMA_MAP — the dealer gamma PROFILE (a standing distribution), distinct from `gexShifts`
   * (how that distribution CHANGED). Rows are strike-ascending as the chain reports them; the
   * template reverses for display and does not re-rank, because a gamma profile's meaning is
   * positional.
   */
  gammaProfile?: {
    rows: { strike: number; gamma: number; display: string }[];
    flipStrike?: number | null;
    /** Expiry the profile was computed for — a gamma map without its expiry is unreadable. */
    expiryLabel?: string | null;
    source: VisualSystem;
  } | null;

  /**
   * FLOW_RECAP — the premium tape. `rows` are individual prints in the order the tape reported
   * them, NOT a curated best-of: the point of a tape card is that it is a tape.
   */
  flow?: {
    windowLabel: string;
    netDisplay: string;
    grossDisplay: string;
    /** Share of gross premium that is call-side, 0–1. Drives the split bar. */
    callShare: number | null;
    printCount: number;
    rows: {
      ticker: string;
      side: "call" | "put";
      premiumDisplay: string;
      detail?: string | null;
      at?: string | null;
    }[];
  } | null;

  /**
   * TRADE_LEADERBOARD — graded results only.
   *
   * `rows` must be GRADED. An ungraded row on a leaderboard is a performance claim the ledger has
   * not made, and unlike TRADE_RECAP (which can honestly show an open position labelled as such)
   * there is no way to rank an open position without implying it is a result.
   */
  leaderboard?: {
    windowLabel: string;
    graded: number;
    wins: number;
    losses: number;
    winRateDisplay: string | null;
    rows: {
      ticker: string;
      contract?: string | null;
      returnValue: number;
      returnDisplay: string;
      dateLabel?: string | null;
    }[];
    source: VisualSystem;
  } | null;

  /**
   * BEFORE_AFTER — the same measurements at two instants. Both stamps are required: "what changed"
   * with only one timestamp is not a comparison, it is an assertion.
   */
  beforeAfter?: {
    windowLabel: string;
    beforeLabel: string;
    afterLabel: string;
    rows: {
      label: string;
      beforeDisplay: string;
      afterDisplay: string;
      deltaDisplay: string | null;
      direction: "up" | "down" | "flat";
      source: VisualSystem;
    }[];
  } | null;

  /**
   * COUNTERFACTUAL — what a fail-closed guard HELD, graded on real bars.
   *
   * The only card in the library that reports on trades that were never taken, which is what makes
   * it publishable evidence rather than marketing: anyone can show what they caught. Both sides are
   * REQUIRED fields — a counterfactual that reports losers-avoided without winners-forgone is a
   * highlight reel of a guard, and the guard's real cost is exactly the forgone side.
   */
  counterfactual?: {
    sessionLabel: string;
    /** The guard being evaluated, named — "Phase-0 fail-closed firewall", "G-4 vix_unavailable". */
    guardLabel: string;
    heldCount: number;
    /** How many of the held plays could be graded. Never assumed equal to `heldCount`. */
    gradedCount: number;
    /**
     * BOTH SIDES CARRY A COUNT, AND THE COUNT IS THE REQUIRED FIELD.
     *
     * The card was first designed against `firewall-rth-replay.mjs`, which grades held plays on
     * minute bars and produces a P&L per side. The measurement production actually persists
     * nightly is a WIN/LOSS verdict per blocked play (`counterfactual_json.would_have_won`), with
     * no P&L attached. So the count is what every source can supply and `pnlDisplay` is optional —
     * present when the source measured return, absent when it measured outcome.
     *
     * Rendering a P&L the source never computed would be the exact fabrication this library
     * exists to prevent, and demanding one would have left the card unfillable from the only
     * production data that exists.
     */
    losersAvoided: { count: number; pnlValue?: number | null; pnlDisplay?: string | null };
    winnersForgone: { count: number; pnlValue?: number | null; pnlDisplay?: string | null };
    /** Blocked plays that would not even have filled — the guard was trivially right. Reported
     *  separately because folding them into "avoided" would flatter the guard. */
    unfilledCount?: number | null;
    netValue?: number | null;
    netDisplay?: string | null;
    rows: {
      ticker: string;
      /** The specific gate that fired. A hold with no named rule is a claim about judgement. */
      gate: string;
      outcomeDisplay: string;
      verdict: "avoided" | "forgone";
    }[];
    source: VisualSystem;
  } | null;

  /**
   * GRADER_AGREEMENT — two independent graders, measured against each other.
   *
   * `comparable` is the population that can actually be tested (rows carrying evidence on BOTH
   * sides) and is distinct from `totalPlays`. Reporting an agreement rate against the wrong
   * denominator is the whole way this measurement gets inflated, so both numbers are required and
   * both are rendered.
   */
  graderAgreement?: {
    windowLabel: string;
    /** What `comparable` actually selects, in words — the reader cannot check a bare fraction. */
    populationLabel: string;
    totalPlays: number;
    comparable: number;
    agreed: number;
    agreementDisplay: string;
    graderALabel: string;
    graderBLabel: string;
    /** EVERY disagreement, not a sample — see the template header. */
    rows: { ticker: string; dateLabel?: string | null; a: string; b: string }[];
    source: VisualSystem;
  } | null;

  /** SESSION_RECAP — one whole session in OHLC plus what the desk did in it. Post-close. */
  session?: {
    dateLabel: string;
    openDisplay: string;
    highDisplay: string;
    lowDisplay: string;
    closeDisplay: string;
    changeDisplay: string | null;
    changeDirection: "up" | "down" | "flat";
    rangeDisplay: string | null;
    /** Free-form desk stats — trades taken, gates held, condor outcome. Rendered as chips. */
    stats: { label: string; value: string; tone?: "neutral" | "positive" | "negative" | "caution" }[];
    source: VisualSystem;
  } | null;

  /** Which systems were consulted this turn — drives attribution and the manifest. */
  systemsQueried: VisualSystem[];
  /** When the underlying snapshot was taken (ISO). */
  asOf: string;
  /** Freshness of the oldest component, so the card can state it. */
  freshness?: "live" | "recent" | "stale" | "unknown";
};

/**
 * THE MANIFEST — the audit trail that ships beside every asset.
 *
 * Answers, for any graphic found in the wild months later: which template, which systems, which
 * snapshot, and the exact value of every number rendered on it. `renderedValues` is deliberately a
 * flat list of label/value/source rather than a copy of the bundle: it records what the card
 * ACTUALLY DREW, which is the auditable claim. A bundle field the template chose not to render is
 * not a claim anyone made.
 */
export type VisualManifest = {
  version: 1;
  assetId: string;
  template: VisualTemplateId;
  size: VisualSize;
  dimensions: { width: number; height: number };
  /** The question that produced the answer this visual renders. */
  question?: string | null;
  /** ISO — when the SNAPSHOT was taken (not when the PNG was encoded; those differ and only the
   *  first is a claim about the market). */
  dataAsOf: string;
  renderedAt: string;
  systemsQueried: VisualSystem[];
  /** Every value the card drew, with where it came from. */
  renderedValues: { label: string; value: string; source: VisualSystem; asOf?: string | null }[];
  /** Components the template omitted because the data was absent. Recorded so a reviewer can tell
   *  a deliberately-omitted block from one that was never part of the design. */
  omitted: string[];
  /** Set when the bundle came from a stored turn rather than a live one. */
  replayOfTurn?: string | null;
};

/** What the render pipeline returns. */
export type RenderedVisual = {
  buffer: Buffer;
  contentType: "image/png" | "image/webp";
  manifest: VisualManifest;
};
