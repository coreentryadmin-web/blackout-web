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

import { checkCaptureUrl } from "@/lib/x-intel/capture-guard";
import type { XIntelFranchise } from "@/lib/x-intel/franchises";
import type { XIntelViewSignature } from "@/lib/x-intel/visual-memory";

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
 * The post's franchise — a recurring, recognisable BLACKOUT format, not a generic category.
 * Defined in `franchises.ts`; re-exported here so the row type stays readable in one place.
 *
 * Stored on the row so the ranker can read the last N and rotate. Rotation you have to remember is
 * rotation you will lose — and the operator's instruction is explicit that the account must NOT
 * invent a fresh identity every hour.
 */
export type { XIntelFranchise } from "@/lib/x-intel/franchises";
export type { XIntelViewSignature } from "@/lib/x-intel/visual-memory";

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
  /** The exact URL captured. Audited by the never-capture check — see `capture-guard.ts`. */
  source_url: string;
  /** C1 — when the frame was taken, not when the row was written. */
  captured_at_et: string;
  /**
   * VISUAL MEMORY. The full state that produced this exact frame — product, page, panel,
   * visualization, ticker, timeframe, filters, composition.
   *
   * Recorded so the next cycle can avoid repeating it. Without this the attachment chooser has no
   * memory and converges on whichever view scored well once, which is how a feed becomes the same
   * two screenshots forever. See `visual-memory.ts`.
   *
   * Null only for a frame that did not come from the catalog — a price chart from outside the
   * platform, for instance. It is never null for a BLACKOUT surface.
   */
  view: XIntelViewSignature | null;
};

/**
 * C7 — the specific numbers that produced the claim, not a restatement of the claim.
 * "call wall 7700 holds 3.2x the gamma of the next strike", never "strong resistance".
 */
/**
 * The horizon a level belongs to.
 *
 * ── WHY THIS FIELD EXISTS (2026-08-21, a real error) ───────────────────────────────────────────
 *
 * A package was drafted quoting `CALL WALL 7,900` for a post about THAT DAY'S session. The number
 * was transcribed correctly from the attachment — but the attachment was the ALL-expiry view, where
 * far-dated OpEx positioning dominates, and the post was about the next six hours.
 *
 * The near-dated read of the same ticker at the same minute was not merely a different number, it
 * was the OPPOSITE STORY:
 *
 *   ALL  : SHORT GAMMA · net GEX -$39.2B · call wall 7,900 · vol EXPANDED   · "no gamma flip"
 *   0DTE : LONG  GAMMA · net GEX -$13.4B · call wall 7,700 · vol SUPPRESSED · flip 7,633
 *
 * The draft told readers dealer hedging would AMPLIFY the move into a 09:45 print, on a session
 * whose 0DTE book says dealers are stabilizing and volatility is suppressed.
 *
 * The operator's ALL-filter rule is a CAPTURE rule — it makes the screenshot show the whole book,
 * and it is correct. The failure was in the COPY: an aggregate across every expiry was narrated as
 * if it described today. So every cited value now carries the horizon it was read at, and the
 * validator below refuses a session claim built on a far-dated aggregate.
 */
export const X_INTEL_HORIZONS = ["0dte", "near", "monthly", "all", "n/a"] as const;
export type XIntelHorizon = (typeof X_INTEL_HORIZONS)[number];

export type XIntelEvidence = {
  what: string;
  value: string;
  source: XIntelEvidenceSource;
  /**
   * Which expiry scope this value was read at. `n/a` for values with no expiry dimension — a spot
   * price, a headline, a timestamp. Required on anything derived from an options book.
   */
  horizon?: XIntelHorizon;
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

/**
 * The call to action, rotated per package and carried SEPARATELY from `post_copy`.
 *
 * `placement` is "body" by operator decision (2026-08-21): the CTA is a rotating one-liner plus a
 * link that REPLACES the `BLACKOUT // <PRODUCTS>` sign-off at the foot of the post. It stays a
 * field rather than a constant so the choice is visible, reversible, and measurable once there is
 * engagement data — see `cta.ts` for the reply-placement argument it overrode.
 *
 * `variant` is stored so the learning loop can attribute conversions to a specific CTA. A rotation
 * nobody records is just variety.
 */
export const X_INTEL_CTA_VARIANTS = [
  "SOFT",
  "DISCORD",
  "SITE",
  "PRICING",
  "WHOP_OFFER",
] as const;

export type XIntelCtaVariant = (typeof X_INTEL_CTA_VARIANTS)[number];

export type XIntelCtaPlacement = "body" | "reply";

export type XIntelCta = {
  variant: XIntelCtaVariant;
  /** Exactly what gets posted as the reply. */
  text: string;
  /** The tagged destination, or null for a variant that deliberately carries no link. */
  url: string | null;
  placement: XIntelCtaPlacement;
};

/**
 * A surface this cycle COULD NOT READ.
 *
 * ── WHY THIS IS A FIELD AND NOT A LOG LINE ─────────────────────────────────────────────────────
 *
 * "We looked at Helix and there was nothing" and "we could not reach Helix" are different claims,
 * and a pipeline that renders both as an empty evidence list has turned an unknown into a
 * measurement. That is the defect class this fleet keeps paying for — the coordinator shipped
 * three instances of it in one morning inside the tooling built to catch it: a 403 rendered as
 * "0 open PRs", an unreadable file list as "touches nothing", an uncomputed merge state as "ready
 * to merge". Each one a blindness reported as a finding.
 *
 * For this lane the shape is specific and dangerous: a story whose evidence could not be READ must
 * not score like a story with genuinely no evidence. The first is a fact about US; the second is a
 * fact about the market. Only the second is publishable.
 *
 * Largo contract C3 is the same rule at the tool boundary; this is it at the package boundary.
 */
export type XIntelBlindSpot = {
  surface: XIntelEvidenceSource;
  /** What specifically could not be read — not "error", but "the flow tape never populated". */
  what_is_missing: string;
  reason: string;
  /** Whether a later cycle could succeed. A permanent gap and a transient one need different handling. */
  retryable: boolean;
};

/**
 * Why a cycle produced no package. A SKIP is a result, but WHICH result matters.
 *
 * `QUIET` is a statement about the market and is the respectable outcome the brief describes.
 * `BLIND` is a statement about the pipeline. Collapsing them would let an outage read as a calm
 * tape — and an operator reading a week of QUIET rows would conclude the market was dull when in
 * fact the harness was down.
 */
export const X_INTEL_SKIP_KINDS = [
  "QUIET",
  "MARKET_CLOSED",
  "BLIND",
  "NO_CAPTURABLE_EVIDENCE",
  "GATED",
] as const;

export type XIntelSkipKind = (typeof X_INTEL_SKIP_KINDS)[number];

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
  franchise: XIntelFranchise | null;
  attachments: XIntelAttachment[];
  products_referenced: XIntelSurface[];
  underlying_evidence: XIntelEvidence[];
  chronology: XIntelChronology | null;
  market_outcome: XIntelOutcome | null;
  /** Absent when uncalibrated — see XIntelConfidence. */
  confidence?: XIntelConfidence;
  /**
   * The rotated call to action, posted as a REPLY to the package — never inside `post_copy`.
   * Null on SKIP: there is no post to reply to.
   */
  cta: XIntelCta | null;
  /** Why this story beat the others. On SKIP, why there was nothing worth posting. */
  reason_selected: string;
  /**
   * Set on SKIP rows. `QUIET` claims the MARKET was quiet and may only be used when nothing was
   * blind — see `readyBlockReason`.
   */
  skip_kind: XIntelSkipKind | null;
  /** Surfaces this cycle could not read. Empty means everything was legible, not that nothing was checked. */
  blind_spots: XIntelBlindSpot[];
  /**
   * True when the copy makes a claim about how TODAY'S session will or did behave, as opposed to
   * describing structural positioning. Drives the horizon check in `readyBlockReason`.
   */
  session_claim: boolean;
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
  > &
    Partial<Pick<XIntelQueueRow, "skip_kind" | "blind_spots" | "products_referenced" | "session_claim">>,
): string | null {
  const blind = row.blind_spots ?? [];

  // A SKIP is still a claim, so it is checked too. `QUIET` says the MARKET was quiet — which is
  // only sayable about surfaces we could actually read. Saying it while blind reports our own
  // outage as a fact about the tape, and a week of those would have an operator concluding the
  // market was dull when the harness was down.
  if (row.status === "SKIP") {
    if (row.skip_kind === "QUIET" && blind.length > 0) {
      return `skip_kind QUIET claims the market was quiet, but ${blind.length} surface(s) could not be read (${blind
        .map((b) => b.surface)
        .join(", ")}) — that is BLIND, not QUIET`;
    }
    if (row.skip_kind === "BLIND" && blind.length === 0) {
      return "skip_kind BLIND with no blind_spots recorded — name what could not be read";
    }
    return null;
  }

  if (row.status !== "READY") return null;

  // A package must not make a claim about a surface it could not see. This is the same rule as
  // the chronology check: the assertion has to rest on something that was actually read.
  const claimed = new Set<string>(row.products_referenced ?? []);
  for (const b of blind) {
    if (claimed.has(b.surface)) {
      return `package references ${b.surface} but that surface could not be read this cycle (${b.what_is_missing}) — an unread surface must not arrive as a read one`;
    }
  }

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

  // ── HORIZON ────────────────────────────────────────────────────────────────────────────────
  //
  // A package about TODAY'S SESSION must not rest on an all-expiry aggregate. See the comment on
  // XIntelHorizon: the same ticker at the same minute read SHORT GAMMA / call wall 7,900 across
  // all expiries and LONG GAMMA / call wall 7,700 at 0DTE. Quoting the first while writing about
  // the next six hours is not a rounding error, it is the opposite claim.
  const optionsEvidence = row.underlying_evidence.filter(
    (e) => e.horizon != null && e.horizon !== "n/a",
  );
  if (optionsEvidence.length && optionsEvidence.every((e) => e.horizon === "all")) {
    if (row.session_claim === true) {
      return "every options-book value is read at the ALL-expiry scope, but the package makes a claim about today's session — far-dated positioning does not describe the next six hours";
    }
  }
  const unlabelled = row.underlying_evidence.filter(
    (e) => e.horizon == null && /wall|gamma|gex|flip|max pain|magnet|vol/i.test(e.what),
  );
  if (unlabelled.length) {
    return `options-book value "${unlabelled[0]!.what}" carries no horizon — a level with no expiry scope cannot be checked against the claim`;
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
 * The never-capture rule lives in ONE place: `capture-guard.ts` (#2510, now on `main`).
 *
 * This file previously carried a denylist-only copy of that check. It was a DECLARED duplication
 * while #2510 was open — flagged in both PR bodies as an ordering dependency, because CLAUDE.md is
 * explicit that a deferral to an open PR is a dependency `automerge.yml` cannot see. #2510 landed,
 * so the copy is deleted here rather than left to drift, which is exactly what a hand-duplicated
 * rule does the first time one side changes.
 *
 * The canonical guard is strictly stronger than what it replaces: DENY first, then an ALLOWLIST of
 * publishable desk surfaces, so an unknown route fails CLOSED. The old local copy could only refuse
 * what it already knew about.
 */
export { checkCaptureUrl, type CaptureVerdict } from "@/lib/x-intel/capture-guard";

/** First refusal across every attachment, or null if all clear. */
export function attachmentCaptureBlockReason(
  attachments: ReadonlyArray<Pick<XIntelAttachment, "slot" | "source_url">>,
): string | null {
  for (const a of attachments) {
    const verdict = checkCaptureUrl(a.source_url);
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
