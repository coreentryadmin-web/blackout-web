import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * EVERY PROSE FIELD ON THE DESK READ GOES THROUGH THE INLINE RENDERER.
 *
 * Measured on the live CRWV read, 2026-08-11: the line under the headline printed
 *
 *     **Low**. The IV rank is median, implied move is tight, and the desk has no fresh
 *     conviction on the name.
 *
 * — asterisks and all. `LargoDeskRead` renders the section bodies, the invalidation and every
 * evidence row through `renderInlineMarkdown`, and rendered the confidence rationale RAW. Largo
 * writes that field in the same voice as the rest (bold for the level, numbers it expects to be
 * stamped), so it was the one place that voice reached the DOM unparsed.
 *
 * A source assertion rather than a DOM test, matching the repo's existing idiom for
 * render-path guarantees (`turn-replay.test.ts`) — the component has no test renderer, and the
 * property worth pinning is "this text is not printed raw", which the source states exactly.
 */
const SRC = join(process.cwd(), "src/features/largo/answer/LargoDeskRead.tsx");

test("the confidence rationale is rendered as markdown, not raw text", () => {
  const src = readFileSync(SRC, "utf8");
  assert.match(src, /renderInlineMarkdown\(envelope\.confidence\.why\)/);
  // The exact shape that shipped the asterisks — a bare interpolation of the same field.
  assert.ok(
    !/\{envelope\.confidence\.why\}/.test(src),
    "confidence.why must never be interpolated directly into JSX",
  );
});

test("no prose field on this component is interpolated bare", () => {
  const src = readFileSync(SRC, "utf8");
  // Fields that carry Largo's own sentences. Identifiers/labels (level, bias) are NOT prose and
  // are deliberately excluded — wrapping those would be noise, not honesty.
  for (const field of ["envelope.invalidation", "envelope.confidence.why"]) {
    const bare = new RegExp(`\\{${field.replace(/\./g, "\\.")}\\}`);
    assert.ok(!bare.test(src), `${field} is interpolated raw — route it through renderInlineMarkdown`);
  }
});

/**
 * A SOURCE NAME AND ITS FRESHNESS ARE TWO FIELDS, AND MUST NOT READ AS ONE SENTENCE.
 *
 * The strip rendered `{src} {fresh}`. On the live CRWV read that produced
 *
 *     NIGHT HAWK EDITION UNKNOWN
 *
 * which parses as "the edition is unknown" — on an answer that had just cited that edition's
 * Aug-4 long pick and stated there was no new CRWV play in tonight's. The edition was known; its
 * AGE was not. "BENZINGA UNKNOWN" in the same strip had the identical problem.
 *
 * `FRESHNESS_LABEL.unknown` is already the unambiguous wording ("Age unknown") and was being
 * bypassed — the raw enum value went to the DOM instead of the label written for it.
 */
test("the source strip separates the source from its freshness, and uses the label", () => {
  const src = readFileSync(SRC, "utf8");
  assert.match(src, /\{src\} · \{FRESHNESS_LABEL\[fresh\]\}/, "source and freshness must be separated");
  assert.ok(!/\{src\} \{fresh\}/.test(src), "the raw enum must not be concatenated onto the source name");
});
