import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveStages, splitEntries } from "./findings-merge-core.mjs";

const PREAMBLE = "# FINDINGS\n\nStanding instructions go here.";

function entry(status) {
  return (
    `## 2026-09-01 — [FINDING, P2] Something broke\n` +
    `> **kind:** FINDING\n` +
    `| Status | ${status} |\n`
  );
}

test("findings-merge-core: fast-forward edit from theirs is NOT silently dropped", () => {
  // `ours` (main) never touched this entry since base; `theirs` (the branch being folded in)
  // flipped its Status from OPEN to FIXED. This is an ordinary, one-sided edit -- not a
  // collision -- and the merged file must carry theirs' update.
  const base = `${PREAMBLE}\n\n${entry("OPEN")}`;
  const ours = base;
  const theirs = `${PREAMBLE}\n\n${entry("FIXED")}`;

  const result = resolveStages({ base, ours, theirs });

  assert.equal(result.ok, true, "a one-sided edit must never be reported as a collision");
  assert.equal(result.contested.length, 0);
  assert.match(
    result.text,
    /\| Status \| FIXED \|/,
    "the merged text must contain theirs' Status update, not the stale OPEN value"
  );
  assert.doesNotMatch(result.text, /\| Status \| OPEN \|/);
});

test("findings-merge-core: genuine two-sided edit collision still refuses", () => {
  const base = `${PREAMBLE}\n\n${entry("OPEN")}`;
  const ours = `${PREAMBLE}\n\n${entry("IN_PROGRESS")}`;
  const theirs = `${PREAMBLE}\n\n${entry("FIXED")}`;

  const result = resolveStages({ base, ours, theirs });

  assert.equal(result.ok, false);
  assert.equal(result.contested.length, 1);
});

test("findings-merge-core: identical edit on both sides is not a collision and is not duplicated", () => {
  const base = `${PREAMBLE}\n\n${entry("OPEN")}`;
  const ours = `${PREAMBLE}\n\n${entry("FIXED")}`;
  const theirs = `${PREAMBLE}\n\n${entry("FIXED")}`;

  const result = resolveStages({ base, ours, theirs });

  assert.equal(result.ok, true);
  assert.equal(result.contested.length, 0);
  const fixedCount = (result.text.match(/\| Status \| FIXED \|/g) ?? []).length;
  assert.equal(fixedCount, 1);
});

test("findings-merge-core: brand-new entry from theirs is still appended", () => {
  const base = `${PREAMBLE}\n\n${entry("OPEN")}`;
  const ours = base;
  const newEntry =
    `## 2026-09-05 — [FINDING, P3] A second thing\n` +
    `> **kind:** FINDING\n` +
    `| Status | OPEN |\n`;
  const theirs = `${PREAMBLE}\n\n${entry("OPEN")}\n${newEntry}`;

  const result = resolveStages({ base, ours, theirs });

  assert.equal(result.ok, true);
  assert.equal(result.added.length, 1);
  assert.match(result.text, /A second thing/);
});

test("splitEntries: sanity on heading/entry split", () => {
  const { preamble, entries } = splitEntries(`${PREAMBLE}\n\n${entry("OPEN")}`);
  assert.equal(preamble.trim(), PREAMBLE.trim());
  assert.equal(entries.length, 1);
});
