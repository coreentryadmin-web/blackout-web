import "server-only";

import { dbConfigured, dbQuery } from "@/lib/db";
import { X_INTEL_FRANCHISES, type XIntelFranchise } from "@/lib/x-intel/franchises";
import type { XIntelVisualMemoryEntry } from "@/lib/x-intel/visual-memory";
import {
  attachmentCaptureBlockReason,
  readyBlockReason,
  X_INTEL_CTA_VARIANTS,
  X_INTEL_STATUSES,
  X_INTEL_SURFACES,
  type XIntelAttachment,
  type XIntelChronology,
  type XIntelConfidence,
  type XIntelCta,
  type XIntelCtaVariant,
  type XIntelEvidence,
  type XIntelOutcome,
  type XIntelQueueDraft,
  type XIntelQueueRow,
  type XIntelRunnerUp,
  type XIntelStatus,
  type XIntelSurface,
} from "@/lib/x-intel/queue-types";

/**
 * X INTEL QUEUE STORE — server-side persistence for the hourly package.
 *
 * WRITE-ONLY WITH RESPECT TO X. Nothing in this module or anything downstream of it may publish.
 * The queue exists precisely so that a human stands between a generated package and the live
 * account, and a store that could post would erase that. `x-api.ts` is deliberately not imported
 * here and must not be.
 *
 * THE INVARIANTS ARE ENFORCED ON WRITE, not on read and not in the caller. `saveQueueRow()`
 * downgrades a package that fails `readyBlockReason()` from READY to REVIEW rather than throwing:
 * an hourly cron that crashes on a marginal package produces no row at all, and a missing row is
 * indistinguishable from a quiet market — which is the one confusion this queue exists to prevent.
 * Downgrading keeps the package, keeps the reason, and puts it in front of a human. Refusing an
 * unsafe CAPTURE is different and does throw: an admin frame must never reach the table at all.
 *
 * ABSENCE IS A FINDING (rule 7). A cycle that produced nothing worth posting writes a SKIP row
 * carrying its reason. It does not write nothing. "No package this hour" and "the pipeline did not
 * run this hour" are different claims and the queue must be able to tell a reviewer which it is.
 */

/** Table name kept in one place — referenced by the store and by the admin route's health check. */
export const X_INTEL_QUEUE_TABLE = "x_intel_queue";

type QueueDbRow = {
  id: string | number;
  cycle_key: string;
  session_date: string | Date;
  created_at_et: string;
  created_at: string | Date;
  status: string;
  ticker_or_market: string;
  headline: string;
  post_copy: string | null;
  thread: unknown;
  franchise: string | null;
  attachments: unknown;
  products_referenced: unknown;
  underlying_evidence: unknown;
  chronology: unknown;
  market_outcome: unknown;
  confidence: unknown;
  reason_selected: string;
  runners_up: unknown;
  posted_tweet_id: string | null;
  cta: unknown;
};

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * Postgres `DATE` comes back as a Date in some driver configurations and a string in others.
 * Rendering it with `toISOString()` would shift a midnight-ET date across the day boundary, which
 * is exactly the C1 defect (#2418) this lane must not reintroduce — so take the calendar parts
 * directly and never round-trip through UTC.
 */
function asSessionDate(value: string | Date): string {
  if (typeof value === "string") return value.slice(0, 10);
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, "0");
  const d = String(value.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function asIso(value: string | Date): string {
  return typeof value === "string" ? value : value.toISOString();
}

function asStatus(value: string): XIntelStatus {
  return (X_INTEL_STATUSES as readonly string[]).includes(value)
    ? (value as XIntelStatus)
    : "REVIEW";
}

const FRANCHISE_SLUGS: ReadonlySet<string> = new Set(X_INTEL_FRANCHISES.map((f) => f.slug));

function asFranchise(value: string | null): XIntelFranchise | null {
  if (!value) return null;
  return FRANCHISE_SLUGS.has(value) ? (value as XIntelFranchise) : null;
}

function asSurfaces(value: unknown): XIntelSurface[] {
  return asArray<string>(value).filter((s): s is XIntelSurface =>
    (X_INTEL_SURFACES as readonly string[]).includes(s),
  );
}

/**
 * C6 — a confidence that is absent in the database stays ABSENT on the row. It is never
 * materialised as `null`, `0`, or a midpoint. A reader that sees no key knows we could not
 * calibrate; a reader handed a number cannot tell an invented one from a measured one.
 */
function asConfidence(value: unknown): XIntelConfidence | undefined {
  if (!value || typeof value !== "object") return undefined;
  const c = value as Partial<XIntelConfidence>;
  if (typeof c.score !== "number" || !Number.isFinite(c.score)) return undefined;
  if (typeof c.basis !== "string" || !c.basis.trim()) return undefined;
  return {
    score: c.score,
    basis: c.basis,
    sample_size: typeof c.sample_size === "number" ? c.sample_size : null,
  };
}

function hydrate(r: QueueDbRow): XIntelQueueRow {
  const confidence = asConfidence(r.confidence);
  const row: XIntelQueueRow = {
    id: Number(r.id),
    cycle_key: r.cycle_key,
    session_date: asSessionDate(r.session_date),
    created_at_et: r.created_at_et,
    created_at: asIso(r.created_at),
    status: asStatus(r.status),
    ticker_or_market: r.ticker_or_market,
    headline: r.headline,
    post_copy: r.post_copy,
    thread: Array.isArray(r.thread) ? (r.thread as string[]) : null,
    franchise: asFranchise(r.franchise),
    attachments: asArray<XIntelAttachment>(r.attachments),
    products_referenced: asSurfaces(r.products_referenced),
    underlying_evidence: asArray<XIntelEvidence>(r.underlying_evidence),
    chronology: (r.chronology as XIntelChronology | null) ?? null,
    market_outcome: (r.market_outcome as XIntelOutcome | null) ?? null,
    reason_selected: r.reason_selected,
    runners_up: asArray<XIntelRunnerUp>(r.runners_up),
    posted_tweet_id: r.posted_tweet_id,
    cta: (r.cta as XIntelCta | null) ?? null,
  };
  if (confidence) row.confidence = confidence;
  return row;
}

const SELECT_COLUMNS = `
  id, cycle_key, session_date, created_at_et, created_at, status,
  ticker_or_market, headline, post_copy, thread, franchise,
  attachments, products_referenced, underlying_evidence, chronology,
  market_outcome, confidence, reason_selected, runners_up, posted_tweet_id, cta
`;

export type SaveQueueRowResult = {
  row: XIntelQueueRow;
  /** Set when the package asked for READY and was held back. Surfaced to the reviewer verbatim. */
  downgraded_from_ready?: string;
};

/**
 * Upsert one cycle's package.
 *
 * Throws only on an unsafe capture — that is a refusal, not a downgrade, because the frame must
 * not be persisted anywhere a reviewer could reach it. Every other invariant failure downgrades
 * to REVIEW and is reported back on the result so the caller can log it.
 */
export async function saveQueueRow(
  draft: XIntelQueueDraft,
): Promise<SaveQueueRowResult | null> {
  if (!dbConfigured()) return null;

  const captureBlock = attachmentCaptureBlockReason(draft.attachments);
  if (captureBlock) {
    throw new Error(`x-intel: refusing to persist package — ${captureBlock}`);
  }

  let status = draft.status;
  let downgraded: string | undefined;
  const block = readyBlockReason(draft);
  if (block) {
    status = "REVIEW";
    downgraded = block;
  }

  const res = await dbQuery<QueueDbRow>(
    `INSERT INTO ${X_INTEL_QUEUE_TABLE} (
       cycle_key, session_date, created_at_et, status, ticker_or_market, headline,
       post_copy, thread, franchise, attachments, products_referenced, underlying_evidence,
       chronology, market_outcome, confidence, reason_selected, runners_up, posted_tweet_id,
       cta
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       $7, $8::jsonb, $9, $10::jsonb, $11::jsonb, $12::jsonb,
       $13::jsonb, $14::jsonb, $15::jsonb, $16, $17::jsonb, $18,
       $19::jsonb
     )
     ON CONFLICT (cycle_key) DO UPDATE SET
       session_date = EXCLUDED.session_date,
       created_at_et = EXCLUDED.created_at_et,
       status = EXCLUDED.status,
       ticker_or_market = EXCLUDED.ticker_or_market,
       headline = EXCLUDED.headline,
       post_copy = EXCLUDED.post_copy,
       thread = EXCLUDED.thread,
       franchise = EXCLUDED.franchise,
       attachments = EXCLUDED.attachments,
       products_referenced = EXCLUDED.products_referenced,
       underlying_evidence = EXCLUDED.underlying_evidence,
       chronology = EXCLUDED.chronology,
       market_outcome = EXCLUDED.market_outcome,
       confidence = EXCLUDED.confidence,
       reason_selected = EXCLUDED.reason_selected,
       runners_up = EXCLUDED.runners_up,
       cta = EXCLUDED.cta
     RETURNING ${SELECT_COLUMNS}`,
    [
      draft.cycle_key,
      draft.session_date,
      draft.created_at_et,
      status,
      draft.ticker_or_market,
      draft.headline,
      draft.post_copy,
      JSON.stringify(draft.thread),
      draft.franchise,
      JSON.stringify(draft.attachments),
      JSON.stringify(draft.products_referenced),
      JSON.stringify(draft.underlying_evidence),
      JSON.stringify(draft.chronology),
      JSON.stringify(draft.market_outcome),
      // `undefined` must reach the column as SQL NULL, not the string "undefined".
      draft.confidence ? JSON.stringify(draft.confidence) : null,
      draft.reason_selected,
      JSON.stringify(draft.runners_up),
      draft.posted_tweet_id,
      JSON.stringify(draft.cta),
    ],
  );

  const row = res.rows[0];
  if (!row) return null;
  return downgraded
    ? { row: hydrate(row), downgraded_from_ready: downgraded }
    : { row: hydrate(row) };
}

export type ListQueueOptions = {
  limit?: number;
  status?: XIntelStatus | "ALL";
  sessionDate?: string;
};

/** Newest first — the reviewer opens the page to see this hour, not the start of the week. */
export async function listQueueRows(
  opts: ListQueueOptions = {},
): Promise<XIntelQueueRow[]> {
  if (!dbConfigured()) return [];

  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const where: string[] = [];
  const values: unknown[] = [];

  if (opts.status && opts.status !== "ALL") {
    values.push(opts.status);
    where.push(`status = $${values.length}`);
  }
  if (opts.sessionDate) {
    values.push(opts.sessionDate);
    where.push(`session_date = $${values.length}`);
  }
  values.push(limit);

  const res = await dbQuery<QueueDbRow>(
    `SELECT ${SELECT_COLUMNS}
       FROM ${X_INTEL_QUEUE_TABLE}
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY created_at DESC
       LIMIT $${values.length}`,
    values,
  );
  return res.rows.map(hydrate);
}

export async function getQueueRowByCycle(
  cycleKey: string,
): Promise<XIntelQueueRow | null> {
  if (!dbConfigured()) return null;
  const res = await dbQuery<QueueDbRow>(
    `SELECT ${SELECT_COLUMNS} FROM ${X_INTEL_QUEUE_TABLE} WHERE cycle_key = $1`,
    [cycleKey],
  );
  const row = res.rows[0];
  return row ? hydrate(row) : null;
}

/**
 * The franchises used most recently, newest first — the ranker reads this to penalise a repeat.
 * SKIP rows are excluded: an hour with nothing to say did not consume a format, and counting it
 * would push the rotation forward on the strength of a post that never existed.
 */
export async function recentFranchises(limit = 8): Promise<XIntelFranchise[]> {
  if (!dbConfigured()) return [];
  const res = await dbQuery<{ franchise: string | null }>(
    `SELECT franchise FROM ${X_INTEL_QUEUE_TABLE}
      WHERE status <> 'SKIP' AND franchise IS NOT NULL
      ORDER BY created_at DESC
      LIMIT $1`,
    [Math.min(Math.max(limit, 1), 50)],
  );
  return res.rows
    .map((r) => asFranchise(r.franchise))
    .filter((f): f is XIntelFranchise => f != null);
}

/**
 * The CTA variants used most recently, newest-first — fed straight into `selectCtaVariant()`.
 *
 * SKIP rows are excluded for the same reason `recentFormats()` excludes them: an hour with nothing
 * to say published no CTA, so counting it would advance the rotation on the strength of a post that
 * never existed.
 */
export async function recentCtaVariants(limit = 8): Promise<XIntelCtaVariant[]> {
  if (!dbConfigured()) return [];
  const res = await dbQuery<{ variant: string | null }>(
    `SELECT cta->>'variant' AS variant FROM ${X_INTEL_QUEUE_TABLE}
      WHERE status <> 'SKIP' AND cta IS NOT NULL
      ORDER BY created_at DESC
      LIMIT $1`,
    [Math.min(Math.max(limit, 1), 50)],
  );
  return res.rows
    .map((r) => r.variant)
    .filter((v): v is XIntelCtaVariant =>
      v != null && (X_INTEL_CTA_VARIANTS as readonly string[]).includes(v),
    );
}

/**
 * Recent attachment view signatures, newest-first — the visual memory the attachment chooser reads
 * before selecting a frame.
 *
 * Flattened across packages and slots so the answer is "what have we photographed lately", not
 * "what did each package use". SKIP rows contribute nothing because they published no frames.
 *
 * The limit is a package count, not an attachment count: `limit` packages back, every frame each
 * one used. Bounding by attachments would make the window silently shorter after a run of
 * three-attachment packages, which is exactly when repetition is most likely.
 */
export async function recentVisualMemory(
  packageLimit = 12,
): Promise<XIntelVisualMemoryEntry[]> {
  if (!dbConfigured()) return [];
  const res = await dbQuery<{ cycle_key: string; attachments: unknown }>(
    `SELECT cycle_key, attachments FROM ${X_INTEL_QUEUE_TABLE}
      WHERE status <> 'SKIP'
      ORDER BY created_at DESC
      LIMIT $1`,
    [Math.min(Math.max(packageLimit, 1), 60)],
  );
  const out: XIntelVisualMemoryEntry[] = [];
  for (const row of res.rows) {
    for (const a of asArray<XIntelAttachment>(row.attachments)) {
      // A frame with no signature (an off-platform price chart) contributes no visual memory —
      // there is no platform view to avoid repeating.
      if (a.view) out.push({ signature: a.view, cycle_key: row.cycle_key });
    }
  }
  return out;
}

/** Records which tweet a package became — the learning loop's join key. */
export async function attachPostedTweetId(
  cycleKey: string,
  tweetId: string,
): Promise<boolean> {
  if (!dbConfigured()) return false;
  // Same shape of guard as x-showcase-post.mjs's assertSafeTweetId: an id from a human paste box
  // ends up in a query and later in an outbound URL, so it is validated before it is stored.
  if (!/^\d{5,25}$/.test(tweetId.trim())) {
    throw new Error("x-intel: refusing to store an invalid tweet id");
  }
  const res = await dbQuery(
    `UPDATE ${X_INTEL_QUEUE_TABLE} SET posted_tweet_id = $2 WHERE cycle_key = $1`,
    [cycleKey, tweetId.trim()],
  );
  return (res.rowCount ?? 0) > 0;
}

/** Backfills the outcome after the fact. Without this the learning loop has no dependent variable. */
export async function recordMarketOutcome(
  cycleKey: string,
  outcome: XIntelOutcome,
): Promise<boolean> {
  if (!dbConfigured()) return false;
  const res = await dbQuery(
    `UPDATE ${X_INTEL_QUEUE_TABLE} SET market_outcome = $2::jsonb WHERE cycle_key = $1`,
    [cycleKey, JSON.stringify(outcome)],
  );
  return (res.rowCount ?? 0) > 0;
}
