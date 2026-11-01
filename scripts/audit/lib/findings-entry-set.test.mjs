import { test } from "node:test";
import assert from "node:assert/strict";
import {
  splitEntries,
  splitAtHeadingBoundaries,
  requiredCounts,
  headingCounts,
  lostEntries,
  alreadyPresent,
} from "./findings-entry-set.mjs";

const H1 = "## 2026-08-23 — [FINDING, P2 X] first";
const H2 = "## 2026-08-22 — [FINDING, P1 Y] second";
const entry = (h, body) => `${h}\n\n> **kind:** \`FINDING\`\n\n${body}`;

const A = entry(H1, "| **Status** | FIXED |");
const A2 = entry(H1, "| **Status** | SUPERSEDED |"); // same heading, DIFFERENT body
const B = entry(H2, "| **Status** | OPEN |");
const doc = (...es) => `# FINDINGS\n\nintro line\n\n${es.join("\n\n")}\n`;

test("splitEntries takes whole entries and ignores the preamble", () => {
  const es = splitEntries(doc(A, B));
  assert.equal(es.length, 2);
  assert.equal(es[0].heading, H1);
  assert.ok(es[0].body.includes("FIXED"));
  assert.ok(!es[0].body.includes("intro line"), "preamble must not be swallowed into an entry");
  // A document with no entries at all is empty, not one giant entry.
  assert.deepEqual(splitEntries("# FINDINGS\n\njust prose\n"), []);
  assert.deepEqual(splitEntries(""), []);
});

test("byte-identical duplicates may collapse — the case that was accumulating", () => {
  const base = doc(A, A, A, B);
  assert.equal(headingCounts(base).get(H1), 3);
  assert.equal(requiredCounts(base).get(H1), 1, "three identical copies are ONE finding");
  assert.deepEqual(lostEntries(base, doc(A, B)), [], "collapsing 3 -> 1 loses nothing");
  assert.deepEqual(lostEntries(base, doc(A, A, B)), [], "collapsing 3 -> 2 loses nothing either");
});

test("same heading with DIFFERENT bodies is two findings and neither may be dropped", () => {
  // `main` really carries two such pairs (2026-08-04, 2026-08-06) — this is not hypothetical.
  const base = doc(A, A2, B);
  assert.equal(requiredCounts(base).get(H1), 2);
  assert.deepEqual(lostEntries(base, doc(A, B)), [H1], "dropping the other version IS a loss");
  assert.deepEqual(lostEntries(base, doc(A, A2, B)), []);
});

test("deleting an entry outright is still a loss, however many copies it had", () => {
  assert.deepEqual(lostEntries(doc(A, B), doc(A)), [H2]);
  assert.deepEqual(lostEntries(doc(A, A, A), doc(B)), [H1], "3 identical -> 0 is still one finding lost");
});

test("editing an entry in place is allowed — the documented supersede workflow", () => {
  // Status edited; heading unchanged. This must not read as a deletion.
  assert.deepEqual(lostEntries(doc(A, B), doc(A2, B)), []);
});

test("adding entries is always fine, and an empty base loses nothing", () => {
  assert.deepEqual(lostEntries(doc(A), doc(A, B)), []);
  assert.deepEqual(lostEntries("", doc(A)), []);
});

test("alreadyPresent compares whole entries, so a changed body still folds", () => {
  const target = doc(A, B);
  assert.equal(alreadyPresent(target, A), true, "verbatim re-fold must be recognised");
  assert.equal(alreadyPresent(target, `${A}\n`), true, "trailing newline must not defeat it");
  assert.equal(alreadyPresent(target, A2), false, "an edited entry is NOT already present");
  assert.equal(alreadyPresent(target, entry("## 2026-08-01 — [FINDING, P3 Z] new", "x")), false);
  assert.equal(alreadyPresent(target, ""), false, "empty input is never 'already present'");
});

test("splitAtHeadingBoundaries matches native text.split(/\\n(?=## )/) on plain input", () => {
  const cases = [
    "a\n## b\nc\n## d\ne",
    "## first\nbody",
    "no heading at all",
    "",
    "## a\n\n## b\n\n## c",
  ];
  for (const text of cases) {
    assert.deepEqual(
      splitAtHeadingBoundaries(text),
      text.split(/\n(?=## )/),
      `mismatch for: ${JSON.stringify(text)}`
    );
  }
});

test("splitAtHeadingBoundaries does not split on a '## ' line quoted inside a fenced code block", () => {
  // Live repro (2026-09-17): a finding's Evidence section quotes a real product's own markdown
  // (a normal, encouraged evidence pattern) containing real `## `-level headings inside a ``` fence
  // — those must not read as document-structure boundaries.
  const text = "## Title\nbody\n```\n## Quoted\nmore\n```\nafter\n## Next\ntail";
  const parts = splitAtHeadingBoundaries(text);
  assert.equal(parts.length, 2, "the fenced '## Quoted' must not create a third chunk");
  assert.ok(parts[0].includes("## Quoted"), "the quoted heading must survive, verbatim, inside its chunk");
  assert.equal(parts[1], "## Next\ntail");
});

test("splitEntries does not fragment an entry whose evidence quotes a heading inside a fence", () => {
  const withFencedQuote = entry(
    H1,
    "Evidence:\n\n```\n## Why this setup\nsome quoted content\n## Trade manager read\nmore\n```\n\nFix rationale."
  );
  const es = splitEntries(doc(withFencedQuote, B));
  assert.equal(es.length, 2, "must be exactly 2 real entries, not fragmented by the quoted headings");
  assert.equal(es[0].heading, H1);
  assert.ok(es[0].body.includes("## Why this setup"), "the quoted content itself must survive inside the entry");
  assert.equal(es[1].heading, H2);
});
