import assert from "node:assert/strict";
import test from "node:test";
import { splitAnswerCaveats } from "./answer-caveats.ts";

test("splitAnswerCaveats pulls trailing coherence blockquote off the body", () => {
  const md = `**Verdict**\n\nSPX is scanning.\n\n> **These two parts of this answer disagree.** The verdict says "no open plays", but the evidence below it reports "48 open positions". Trust the evidence.`;
  const { body, caveats } = splitAnswerCaveats(md);
  assert.match(body, /SPX is scanning/);
  assert.equal(caveats.length, 1);
  assert.equal(caveats[0]!.kind, "coherence");
  assert.match(caveats[0]!.body, /disagree/);
});

test("splitAnswerCaveats leaves clean answers unchanged", () => {
  const md = "**Verdict**\n\nNVDA spot 223.";
  const { body, caveats } = splitAnswerCaveats(md);
  assert.equal(body, md);
  assert.deepEqual(caveats, []);
});

test("splitAnswerCaveats classifies data integrity hold", () => {
  const md = `**Verdict**\n\nWait.\n\n> **Data integrity hold.** NVDA spot readings range 216.65 to 223.52 (3.17% apart). Precise entry withheld.`;
  const { caveats } = splitAnswerCaveats(md);
  assert.equal(caveats.length, 1);
  assert.equal(caveats[0]!.kind, "integrity");
});
