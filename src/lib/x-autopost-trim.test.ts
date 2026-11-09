import { test } from "node:test";
import assert from "node:assert/strict";
import { trimToLimit } from "@/lib/x-autopost-trim";
import { xPostFooterLine } from "@/lib/x-whop-link";

/**
 * Regression for the FIFTH un-migrated copy of the truncate-text.ts consolidation bug
 * (round 437; see the BUG FIX comment on `trimToLimit` in `src/lib/x-autopost-trim.ts`).
 *
 * The old implementation was:
 *   return body.slice(0, maxBody).trimEnd() + "…" + footer;
 * which (a) glues the ellipsis directly onto whatever trailing punctuation the hard cut
 * happened to land on, since `trimEnd()` only strips whitespace, and (b) appends "…"
 * unconditionally even when `body` already fit inside `maxBody` and no cut occurred at
 * all. `oldTrimForRegressionOnly` below is that exact dead logic, kept ONLY so this test
 * can demonstrate the bug it used to have (RED) without reverting the real fix.
 */

const POST_TYPE = "desk_open" as const;

function oldTrimForRegressionOnly(content: string, footer: string, maxBody: number): string {
  if (content.length <= 280) return content;
  const body = content.slice(0, content.lastIndexOf("\n"));
  return body.slice(0, maxBody).trimEnd() + "…" + footer;
}

function buildPunctuationBoundaryContent(postType: typeof POST_TYPE) {
  const footer = `\n${xPostFooterLine(postType)}`;
  const maxBody = 280 - footer.length - 1;
  // A run of "." characters straddling both candidate cut points (`maxBody` and
  // `maxBody - 1`, the off-by-one between the old code's slice and `truncateText`'s own
  // internal reservation for its ellipsis) guarantees whichever one is used, the hard
  // cut lands inside the punctuation run.
  const bodyText = "A".repeat(maxBody - 5) + ".".repeat(40) + "Z".repeat(80);
  const oldFooterLine = "stale old footer line that must be stripped and replaced";
  const content = `${bodyText}\n${oldFooterLine}`;
  return { content, footer, maxBody };
}

test("the old trimToLimit logic really did glue punctuation onto the ellipsis (RED proof)", () => {
  const { content, footer, maxBody } = buildPunctuationBoundaryContent(POST_TYPE);
  const oldResult = oldTrimForRegressionOnly(content, footer, maxBody);
  assert.match(
    oldResult,
    /[.,;:]…/,
    "sanity check: the old logic must reproduce the double-punctuation bug on this input",
  );
});

test("trimToLimit (fixed) never glues trailing punctuation onto the ellipsis", () => {
  const { content } = buildPunctuationBoundaryContent(POST_TYPE);
  const result = trimToLimit(content, POST_TYPE);

  assert.ok(result.length <= 280, `result exceeded 280 chars: ${result.length}`);
  assert.doesNotMatch(
    result,
    /[.,;:]…/,
    `result still glues punctuation onto the ellipsis: ${JSON.stringify(result)}`,
  );
  assert.ok(result.includes("…"), "expected truncation to still add an ellipsis when actually over budget");
  assert.ok(result.endsWith(xPostFooterLine(POST_TYPE)), "result must still end with a fresh footer");
});

test("trimToLimit does not append a spurious ellipsis when the stripped body already fits", () => {
  // A short body whose overall `content` exceeds 280 chars ONLY because of its own
  // trailing old-footer line — once that line is stripped (via `content.slice(0,
  // lastIndexOf("\n"))`), the body alone is well under `maxBody` and needs no
  // truncation at all. The old code appended "…" unconditionally regardless, mangling
  // an otherwise-complete, already-short post.
  const shortBody = "SPY holding the call wall. Dealers stay net short gamma into the close.";
  const oldFooterLine = "x".repeat(260); // forces content.length > 280 via the stripped line alone
  const content = `${shortBody}\n${oldFooterLine}`;
  assert.ok(content.length > 280, "test setup must exceed the 280 trigger");

  const result = trimToLimit(content, POST_TYPE);

  assert.ok(
    result.startsWith(shortBody),
    `expected the untruncated body to survive intact, got: ${JSON.stringify(result)}`,
  );
  assert.ok(
    !result.includes("…"),
    `did not expect an ellipsis when no truncation was needed: ${JSON.stringify(result)}`,
  );
});
