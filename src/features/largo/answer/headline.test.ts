import test from "node:test";
import assert from "node:assert/strict";
import { splitHeadline, HEADER_MAX_CHARS } from "./headline";

/** The live 380-char "headline" that was being rendered in display type. */
const LIVE_VERDICT =
  "The SPX 7800 call wall is **holding but weakening**. It has shed -$177.8M GEX in the last 60 " +
  "seconds (down 3.9% from peak), and the gamma flip just migrated down 3.73 pts to 7,762.83. " +
  "Dealers are getting longer (gamma regime flipped short → long at 14:38:17), which compresses " +
  "vol and favors mean reversion, not breakouts.";

test("the header is ONE sentence, not the whole verdict", () => {
  const { header, rest } = splitHeadline(LIVE_VERDICT);
  assert.equal(header, "The SPX 7800 call wall is holding but weakening.");
  assert.ok(header.length <= HEADER_MAX_CHARS);
  assert.match(rest, /^It has shed/);
  // The elaboration is kept, not discarded by the splitter.
  assert.match(rest, /mean reversion, not breakouts\.$/);
});

test("markdown emphasis is stripped — display type must not show asterisks", () => {
  assert.equal(splitHeadline("**Bullish** on SPX. More text.").header, "Bullish on SPX.");
  assert.equal(splitHeadline("*Mixed* read. Detail.").header, "Mixed read.");
});

test("decimals, money, times and 0DTE do not split the header", () => {
  // A naive split on "." cuts every one of these in half.
  for (const s of [
    "SPX is at 7,762.83 and holding. Next line.",
    "Flow is -$177.8M today. Next line.",
    "The flip moved at 14:38:17 ET. Next line.",
    "Watch the 0DTE roll. Next line.",
  ]) {
    const { header } = splitHeadline(s);
    assert.equal(header.endsWith("Next line."), false, s);
    assert.match(header, /\.$/);
  }
});

test("a single-sentence verdict yields an empty rest", () => {
  const { header, rest } = splitHeadline("SPX is pinned at the 7800 wall.");
  assert.equal(header, "SPX is pinned at the 7800 wall.");
  assert.equal(rest, "");
});

test("one very long sentence is cut at a clause boundary, with an ellipsis", () => {
  const long =
    "The SPX 7800 call wall is holding but weakening as dealers rebalance into the close — " +
    "and the gamma flip keeps migrating lower while breadth deteriorates and the tape stays mixed.";
  const { header, rest } = splitHeadline(long);
  assert.ok(header.length <= HEADER_MAX_CHARS + 1, `header was ${header.length}`);
  // Truncated headers must be visibly truncated — never read as a complete claim.
  assert.match(header, /…$/);
  assert.equal(header.includes("  "), false);
  // The cut text is moved into rest, not dropped.
  assert.ok(rest.length > 0);
});

test("a long sentence is never cut mid-word", () => {
  const { header } = splitHeadline("A".repeat(40) + " " + "B".repeat(200));
  assert.match(header, /^A+…$/);
});

test("empty and whitespace input yield an empty header, never a crash", () => {
  for (const v of ["", "   ", null, undefined]) {
    assert.deepEqual(splitHeadline(v as string), { header: "", rest: "" });
  }
});

test("newlines and runs of whitespace collapse — a header is one line", () => {
  const { header } = splitHeadline("SPX is\n\n  pinned   at 7800. More.");
  assert.equal(header, "SPX is pinned at 7800.");
});
