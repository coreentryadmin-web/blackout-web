/**
 * X INTEL QUEUE — the row a human opens, reads and publishes by hand.
 *
 * CLIENT-SAFE. Types and pure predicates only, no `pg` import — the admin panel is a client
 * component and importing the store here would drag the pool into the browser bundle. The store
 * lives in `queue-store.ts` and imports FROM this file, never the other way round.
 *
 * ── WHY THE SHAPE IS WHAT IT IS ────────────────────────────────────────────────────────────────
 *
 * Every field below exists so a reviewer can act on the package WITHOUT asking the pipeline a
 * follow-up question. That is the whole design constraint: a queue row that needs a conversation
 * to interpret has not saved anyone any work.
 *
 * Three of the fields are load-bearing beyond display, and each encodes a rule that has already
 * cost this repo something:
 *
 * - `confidence` is OPTIONAL and must be OMITTED when it cannot be calibrated. Largo product
 *   contract C6: an invented 0.7 is worse than nothing because it gets compared against another
 *   lane's real one. Do not add a default. Do not coerce a missing score to 0.5.
 *
 * - `chronology` carries the two timestamps a precedence claim compares, as MACHINE-READABLE
 *   epochs, so `readyBlockReason()` below can refuse the row. "BLACKOUT caught it first" is
 *   the single most damaging thing this account could publish if it turns out to be backfilled,
 *   and editorial care is not a control. See the predicate's own comment.
 *
 * - `attachments[].source_url` is recorded so the never-capture rule can be enforced against the
 *   URL a frame actually came from, rather than trusted to the harness's good behaviour. One
 *   leaked admin frame is permanent.
 *
 * Time follows contract C1 throughout: an ET wall-clock stamp AND a session date, never a bare
 * epoch on its own. Epoch-ms fields exist ONLY inside `chronology`, where ordering is the point,
 * and they are always accompanied by their ET rendering.
 */

/** The seven intelligence surfaces this lane reads, plus the market itself for price frames. */
export const X_INTEL_SURFACES = [
  "spx_slayer",
  "helix",
  "thermal",
  "vector",
  "nighthawk",
  "meridian",
  "largo",
] as const;

export type XIntelSurface = (typeof X_INTEL_SURFACES)[number];

/** Price/market frames are not a BLACKOUT surface — they are the thing a surface saw. */
export type XIntelEvidenceSource = XIntelSurface | "market";

export const X_INTEL_STATUSES = ["READY", "REVIEW", "SKIP"] as const;
export type XIntelStatus = (typeof X_INTEL_STATUSES)[number];

/**
 * Post formats, rotated so the account does not ship the same template every hour.
 * Stored on the row so the ranker can read the last N and penalise a repeat — rotation you have
 * to remember is rotation you will lose.
 */
export const X_INTEL_FORMATS = [
  "BREAKING_MARKET_MOVE",
  "WHALE_FLOW",
  "SPX_INTELLIGENCE",
  "GAMMA_SHIFT",
  "BLACKOUT_CALLED_IT",
  "TRADE_UPDATE",
  "EARNINGS_MOVE",
  "CROSS_PRODUCT_CONFLUENCE",
  "MARKET_DIVERGENCE",
  "WHAT_CHANGED",
  "CLOSING_INTELLIGENCE",
] as const;

export type XIntelFormat = (typeof X_INTEL_FORMATS)[number];

/**
 * The three-beat attachment story: WHAT HAPPENED → WHAT BLACKOUT SAW → WHY IT MATTERED.
 * `role` is explicit rather than inferred from slot order so a two-attachment package can still
 * say which beat is missing instead of silently looking like a truncated three.
 */
export type XIntelAttachmentRole = "PRICE" | "BLACKOUT_SIGNAL" | "CONFIRMATION";

export type XIntelAttachment = {
  slot: 1 | 2 | 3;
  role: XIntelAttachmentRole;
  /** Where the reviewer downloads the frame from. */
  image_url: string;
  caption: string;
  source_surface: XIntelEvidenceSource;
  /** The exact URL captured. Audited by the never-capture check — see `isCapturableSourceUrl`. */
  source_url: string;
  /** C1 — when the frame was taken, not when the row was written. */
  captured_at_et: string;
};

/**
 * C7 — the specific numbers that produced the claim, not a restatement of the claim.
 * "call wall 7700 holds 3.2x the gamma of the next strike", never "strong resistance".
 */
export type XIntelEvidence = {
  what: string;
  value: string;
  source: XIntelEvidenceSource;
};

/** One dated mark on the story's timeline — the "10:34 → 10:51 → 11:18" ladder. */
export type XIntelMark = {
  /** C1 rendering, e.g. "2026-08-21 10:34 ET". */
  at_et: string;
  /** Epoch ms. Present so ordering is decided by arithmetic, not by string comparison. */
  at_ms: number;
  what: string;
  surface?: XIntelEvidenceSource;
};

/**
 * The structured basis for any "BLACKOUT saw this first" claim.
 *
 * `precedence_claimed` is the reviewer-visible assertion; `detection` and `market_event` are the
 * two instants it rests on. Both must be present and strictly ordered for the row to reach READY.
 * A package that merely REPORTS a move after the fact sets `precedence_claimed: false` and is
 * perfectly publishable — the flag distinguishes "we caught it" from "here is what happened",
 * which is exactly the distinction that must never blur.
 */
export type XIntelChronology = {
  precedence_claimed: boolean;
  detection: XIntelMark | null;
  market_event: XIntelMark | null;
  /** Additional ordered marks for display. Not used by the precedence check. */
  marks: XIntelMark[];
};

/**
 * C6 — omit entirely rather than invent. There is deliberately no default and no nullable score:
 * the field is absent or it is calibrated.
 */
export type XIntelConfidence = {
  /** 0..1 */
  score: number;
  basis: string;
  sample_size: number | null;
};

/** Backfilled after the fact. This is what makes the learning loop possible at all. */
export type XIntelOutcome = {
  measured_at_et: string;
  what_happened: string;
  /** e.g. "6,784 → 6,751 (-33 pts)". Free text: the move's shape differs per story type. */
  move: string | null;
};

/** A story that lost, kept so the reviewer can see what the ranker passed over. */
export type XIntelRunnerUp = {
  headline: string;
  score: number;
  why_not: string;
};

export type XIntelQueueRow = {
  id: number;
  /**
   * One package per cycle. UNIQUE in the table, so a re-run of the same hour overwrites its own
   * slot instead of leaving a duplicate — same reasoning as `meridian_report_snapshots`'
   * `snapshot_day` key. Format: `<session_date>T<hh>` in ET, e.g. "2026-08-21T11".
   */
  cycle_key: string;
  /** C1 — every dated row carries its session date. */
  session_date: string;
  /** C1 — "YYYY-MM-DD HH:mm ET". */
  created_at_et: string;
  created_at: string;
  status: XIntelStatus;
  ticker_or_market: string;
  headline: string;
  /** Exactly what gets pasted. Null on SKIP — there is nothing to publish. */
  post_copy: string | null;
  /** Ordered. Null when the package is a single post rather than a thread. */
  thread: string[] | null;
  format: XIntelFormat | null;
  attachments: XIntelAttachment[];
  products_referenced: XIntelSurface[];
  underlying_evidence: XIntelEvidence[];
  chronology: XIntelChronology | null;
  market_outcome: XIntelOutcome | null;
  /** Absent when uncalibrated — see XIntelConfidence. */
  confidence?: XIntelConfidence;
  /** Why this story beat the others. On SKIP, why there was nothing worth posting. */
  reason_selected: string;
  runners_up: XIntelRunnerUp[];
  /**
   * Filled in by a human after they publish. This is the join key the learning loop needs to get
   * from a package to its impressions — without it, analytics can only be keyed by tweet text,
   * which is what the existing `x-analytics` snapshot already does and cannot attribute.
   */
  posted_tweet_id: string | null;
};

/** Everything a writer supplies. `id` and `created_at` are the store's to assign. */
export type XIntelQueueDraft = Omit<XIntelQueueRow, "id" | "created_at">;

// ---------------------------------------------------------------------------
// Pure predicates — unit-tested, and called by the store before it writes.
// ---------------------------------------------------------------------------

/**
 * Why a package may NOT be marked READY, or null if it may.
 *
 * This is deliberately a REFUSAL, not a warning. The brief's rule is that a precedence claim is
 * enforced mechanically rather than editorially, and a check that merely annotates the row leaves
 * the bad claim publishable by a reviewer who trusts the queue.
 *
 * Step 5 (copywriting + the full chronology validator) extends this with the copy-vs-fields
 * cross-check — that the POST TEXT does not assert precedence the fields do not carry. The
 * structural half lives here because the store must never persist a READY row that fails it,
 * and a guard that only runs in the writer can be bypassed by the next writer.
 */
export function readyBlockReason(
  row: Pick<
    XIntelQueueRow,
    "status" | "post_copy" | "attachments" | "chronology" | "underlying_evidence"
  >,
): string | null {
  if (row.status !== "READY") return null;

  if (!row.post_copy || !row.post_copy.trim()) {
    return "READY requires post_copy — there is nothing for a reviewer to paste";
  }

  // The package format IS the proof. Two genuinely distinct surfaces is the floor; three
  // near-identical frames is a failed package, not a strong one, so the count is not the test —
  // distinctness is, and it is checked below.
  if (row.attachments.length < 2) {
    return `READY requires at least 2 attachments (has ${row.attachments.length})`;
  }

  const surfaces = new Set(row.attachments.map((a) => a.source_surface));
  if (surfaces.size < 2) {
    return "READY requires attachments from at least 2 DIFFERENT surfaces — near-identical frames are not corroboration";
  }

  if (!row.underlying_evidence.length) {
    return "READY requires at least one underlying_evidence entry — a claim with no numbers behind it";
  }

  const chron = row.chronology;
  if (chron?.precedence_claimed) {
    if (!chron.detection || !chron.market_event) {
      return "precedence_claimed requires BOTH a detection and a market_event timestamp";
    }
    if (!(chron.detection.at_ms < chron.market_event.at_ms)) {
      return `precedence_claimed but detection (${chron.detection.at_et}) is not strictly earlier than the market event (${chron.market_event.at_et})`;
    }
  }

  return null;
}

/**
 * Routes a frame must never be captured from, matched against the URL the image actually came
 * from. Enforced in code rather than left to the harness's care: the capture session runs as
 * `role: "admin"` (every audit harness mints an admin+premium Clerk user), so a privileged frame
 * is the DEFAULT capability, not an unlikely accident — and the account it would be published to
 * is public.
 *
 * Deny-list rather than allow-list is a deliberate, narrow choice: the seven desks live at paths
 * this lane does not own and that other lanes rename, so an allow-list here would silently start
 * refusing legitimate captures on someone else's route change. Step 3 pairs this with the
 * per-surface config table, where each entry names its own URL — that table is the allow-list.
 */
const NEVER_CAPTURE_PATTERNS: ReadonlyArray<{ re: RegExp; why: string }> = [
  { re: /^\/admin(\/|$)/i, why: "admin console" },
  { re: /^\/api\/admin(\/|$)/i, why: "admin API" },
  { re: /^\/api\/cron(\/|$)/i, why: "cron endpoint" },
  { re: /^\/api\/debug(\/|$)/i, why: "debug output" },
  { re: /^\/api\/webhooks(\/|$)/i, why: "webhook endpoint" },
  { re: /^\/sign-in(\/|$)/i, why: "auth screen" },
  { re: /^\/sign-up(\/|$)/i, why: "auth screen" },
  { re: /^\/account(\/|$)/i, why: "personal account page" },
  { re: /^\/settings(\/|$)/i, why: "personal settings page" },
];

export type CaptureUrlVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Whether a frame from this URL may be attached to a package.
 *
 * Refuses on anything it cannot positively parse, including a relative URL or a non-BLACKOUT
 * host: a source it cannot classify is a source it cannot clear, and "unparseable" must not
 * degrade into "allowed". Query strings are checked too — a debug flag on an otherwise public
 * route can render internal state onto a public page.
 */
export function isCapturableSourceUrl(rawUrl: string): CaptureUrlVerdict {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: `unparseable source_url: ${rawUrl.slice(0, 80)}` };
  }

  if (url.protocol !== "https:") {
    return { ok: false, reason: `source_url must be https (got ${url.protocol})` };
  }

  for (const { re, why } of NEVER_CAPTURE_PATTERNS) {
    if (re.test(url.pathname)) {
      return { ok: false, reason: `refusing capture from ${why}: ${url.pathname}` };
    }
  }

  if (/(^|&)(debug|__debug|trace)=/i.test(url.search)) {
    return { ok: false, reason: `refusing capture from a debug-flagged URL: ${url.search}` };
  }

  return { ok: true };
}

/** First refusal across every attachment, or null if all clear. */
export function attachmentCaptureBlockReason(
  attachments: ReadonlyArray<Pick<XIntelAttachment, "slot" | "source_url">>,
): string | null {
  for (const a of attachments) {
    const verdict = isCapturableSourceUrl(a.source_url);
    if (!verdict.ok) return `attachment ${a.slot}: ${verdict.reason}`;
  }
  return null;
}

/**
 * The ET hour slot a package belongs to — "2026-08-21T11". One package per cycle, so this is the
 * table's uniqueness key.
 *
 * It is derived from the ET wall clock, NEVER from the UTC hour the cron happened to fire at. That
 * distinction is the whole point: `x-autopost` matches a UTC cron against ET hours and therefore
 * misses all seven of its daily slots for the four months the US is on standard time. Deriving the
 * slot from the instant means this pipeline cannot acquire the same defect — the cron says when to
 * LOOK, and the clock says which cycle that is.
 *
 * Takes epoch ms and returns null on anything that is not one, rather than defaulting to "now":
 * a slot silently attributed to the wrong hour would overwrite a real package.
 */
export function cycleKeyForEt(
  atMs: number,
  deps: { etStamp: (t: unknown) => string | null; etSessionDate: (t: unknown) => string | null },
): string | null {
  const stamp = deps.etStamp(atMs);
  const date = deps.etSessionDate(atMs);
  if (!stamp || !date) return null;
  // `etStamp` is "YYYY-MM-DD HH:mm ET" — read the hour off it so the ET conversion happens exactly
  // once, inside the shared helper, rather than a second time here with a second Intl call that
  // could disagree with it.
  return `${date}T${stamp.slice(11, 13)}`;
}
