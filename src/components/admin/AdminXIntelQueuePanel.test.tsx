import assert from "node:assert/strict";
import { test } from "node:test";
import { xIntelPostCopyDisplay } from "./AdminXIntelQueuePanel";

// Regression (DISCOVERY sweep round 174): `PackageCard` decided whether to render the "Post
// copy" block or the skip-flavored block purely off `row.post_copy` truthiness
// (`row.post_copy ? <PostCopy/> : <SkipBlock/>`), never checking `row.status`/`isSkip`.
//
// `queue-store.ts`'s `saveQueueRow()` downgrades a candidate that fails `readyBlockReason()`
// from READY to **REVIEW** rather than discarding it ("downgrades... rather than throwing...
// keeps the package, keeps the reason, and puts it in front of a human"). One of
// `readyBlockReason`'s own checks is exactly "READY requires post_copy — there is nothing for a
// reviewer to paste", which fires precisely when `post_copy` is null/empty. So a REVIEW row with
// `post_copy: null` is a real, reachable shape — and the old ternary rendered it with the
// skip-specific header ("No high-value post this hour", or worse "Skipped — could not read the
// platform" if a stale `skip_kind` survived from an earlier stage), claiming the pipeline
// SKIPPED this cycle when it actually selected a real story and is simply waiting on a human to
// finish drafting the copy. That is the exact "absence mislabeled as a different kind of
// absence" this file's own design-rule comments (and `shouldShowXIntelFixtures`,
// `readyBlockReason`'s BLIND-vs-QUIET split) explicitly exist to prevent.
//
// The fix: gate the skip-flavored block on `row.status === "SKIP"`, matching every other
// isSkip-gated branch in this file, and give a REVIEW/READY row with no post_copy yet its own
// honest "awaiting copy" state instead of borrowing SKIP's wording.

test("xIntelPostCopyDisplay: a SKIP row with skip_kind BLIND renders the BLIND label", () => {
  const d = xIntelPostCopyDisplay({ status: "SKIP", post_copy: null, skip_kind: "BLIND" });
  assert.deepEqual(d, { kind: "skip", label: "Skipped — could not read the platform" });
});

test("xIntelPostCopyDisplay: a SKIP row with skip_kind MARKET_CLOSED renders that label", () => {
  const d = xIntelPostCopyDisplay({ status: "SKIP", post_copy: null, skip_kind: "MARKET_CLOSED" });
  assert.deepEqual(d, { kind: "skip", label: "Skipped — market closed" });
});

test("xIntelPostCopyDisplay: a SKIP row with any other skip_kind (e.g. QUIET) renders the generic label", () => {
  const d = xIntelPostCopyDisplay({ status: "SKIP", post_copy: null, skip_kind: "QUIET" });
  assert.deepEqual(d, { kind: "skip", label: "No high-value post this hour" });
});

test("xIntelPostCopyDisplay: a READY row with real post_copy renders the post_copy text", () => {
  const d = xIntelPostCopyDisplay({ status: "READY", post_copy: "⚡ real post", skip_kind: null });
  assert.deepEqual(d, { kind: "post_copy", text: "⚡ real post" });
});

test("xIntelPostCopyDisplay: REGRESSION — a REVIEW row downgraded for missing post_copy must NOT read as a skip decision", () => {
  // This is exactly the saveQueueRow() downgrade shape: readyBlockReason() failed on
  // "READY requires post_copy", status became REVIEW, post_copy stayed null, and the row's own
  // skip_kind was never a skip field to begin with (null, same as any non-SKIP candidate).
  const d = xIntelPostCopyDisplay({ status: "REVIEW", post_copy: null, skip_kind: null });
  assert.equal(
    d.kind,
    "awaiting_copy",
    "a REVIEW row missing post_copy was selected, not skipped — it must not render the SKIP wording",
  );
});

test("xIntelPostCopyDisplay: REGRESSION — status gates the block, not a stale skip_kind value alone", () => {
  // Even if a leftover/stale skip_kind happens to survive on a non-SKIP row, status must win —
  // skip_kind is documented as "Set on SKIP rows" and must never drive the skip rendering by itself.
  const d = xIntelPostCopyDisplay({ status: "REVIEW", post_copy: null, skip_kind: "BLIND" });
  assert.equal(
    d.kind,
    "awaiting_copy",
    "a REVIEW row must never render 'Skipped — could not read the platform' — it was not skipped",
  );
});

test("xIntelPostCopyDisplay: empty-string post_copy on a non-SKIP row is treated as awaiting copy, not a value to paste", () => {
  const d = xIntelPostCopyDisplay({ status: "REVIEW", post_copy: "   ", skip_kind: null });
  assert.equal(d.kind, "awaiting_copy");
});
