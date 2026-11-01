/**
 * Pure ET date/time helpers for the x-intel cron's queue rows.
 *
 * Kept out of `route.ts` — Next.js rejects non-route exports from App Router route modules
 * (same reason `thermal-discord-dedup.ts`/`thermal-discord-rth.ts` exist as sibling files).
 *
 * ROOT CAUSE this fixes: `route.ts` used to derive "now" independently at every call site —
 * `etDateString()`, `etTimeString()`, `cycleName()`, and again inside `captureAttachments()`'s
 * inline image path — each calling its own fresh `nowET()` (`new Date()`) instead of reusing the
 * ONE `et` already captured at the top of the request to pick `postType`. Real wall-clock time
 * elapses between that top-of-request read and these later call sites: `fetchMarketSnapshot()`,
 * `generateTweetContent()` (up to 3 sequential AI-generation attempts via `anthropicText`), and
 * `captureAttachments()` (a PNG render) are all awaited in between — easily seconds, well inside
 * this route's own 90s `maxDuration`. If the ET clock ticks over an HOUR boundary (or, right at
 * midnight, a DATE boundary) during that window, a single request can persist ONE queue row whose
 * `cycle_key` (the table's own unique key — see `queue-store.ts`'s `ON CONFLICT (cycle_key)`)
 * carries a different hour than the `postType` it was actually selected for, and whose
 * `attachments[].image_url` path (from a THIRD, independently-timed `nowET()` call inside
 * `captureAttachments`) can disagree with `cycle_key`'s own date/hour — two fields on the same
 * persisted row silently describing two different moments of the same request.
 *
 * A second, independent inconsistency compounded this: `cycleName()`'s hour segment was
 * zero-padded (`"09"`) while `captureAttachments()`'s inline image path used the RAW
 * `.getHours()` number (`"9"`) for what both call sites intend as the same "hour bucket" label —
 * so even holding the clock still, the two never shared a format.
 *
 * FIX: every helper below is pure and takes the already-captured `et: Date` as an explicit
 * parameter — no helper here ever reads the clock itself. `route.ts` captures `et` exactly once
 * (the same read it already uses to select `postType`) and threads it through every downstream
 * call, so every field on one persisted row is derived from the same instant by construction, and
 * the hour segment is formatted identically everywhere it appears.
 */

/** YYYY-MM-DD in `et`'s own calendar fields (no re-read of the clock). */
export function etDateString(et: Date): string {
  const year = et.getFullYear();
  const month = String(et.getMonth() + 1).padStart(2, "0");
  const day = String(et.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** HH:MM:SS ET in `et`'s own clock fields. */
export function etTimeString(et: Date): string {
  const hours = String(et.getHours()).padStart(2, "0");
  const minutes = String(et.getMinutes()).padStart(2, "0");
  const seconds = String(et.getSeconds()).padStart(2, "0");
  return `${hours}:${minutes}:${seconds} ET`;
}

/** Zero-padded HH hour bucket from `et` — shared by cycleName/attachmentImagePath so both
 *  always agree on the same hour string, not just the same hour number. */
function hourBucket(et: Date): string {
  return String(et.getHours()).padStart(2, "0");
}

/** The queue table's unique key for this post slot: `<date>T<hour>:<postType>`. */
export function cycleName(et: Date, postType: string): string {
  return `${etDateString(et)}T${hourBucket(et)}:${postType}`;
}

/** Desk-card attachment path for this slot — same date/hour bucket `cycleName` uses, so the
 *  two fields on one persisted row can never drift apart even if real time passes between the
 *  calls that build them (they no longer read the clock at all; both take the same `et`). */
export function attachmentImagePath(et: Date, postType: string): string {
  return `/x-intel/${etDateString(et)}T${hourBucket(et)}/${postType}-desk.png`;
}
