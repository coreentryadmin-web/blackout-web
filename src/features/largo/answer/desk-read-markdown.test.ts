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
