import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error -- plain .mjs audit helper, no type declarations by design.
import { countGlued, repairGlued, resolveStages, splitEntries } from "../scripts/audit/lib/findings-merge-core.mjs";

const PREAMBLE = "# FINDINGS\n\nRun log lives in RUN-LOG.md.\n";

function entry(title: string, body = "detail"): string {
  return [
    `## 2026-08-21 — [FINDING, P1 test] ${title}`,
    "",
    "> **kind:** `FINDING`",
    "",
    "| Field | Detail |",
    "|---|---|",
    `| **Status** | ${body} |`,
    "",
  ].join("\n");
}

function file(...entries: string[]): string {
  return `${PREAMBLE}\n${entries.join("\n")}`;
}

test("splitEntries keeps the preamble out of the entry list", () => {
  const { preamble, entries } = splitEntries(file(entry("A"), entry("B")));
  assert.ok(preamble.startsWith("# FINDINGS"));
  assert.equal(entries.length, 2);
  assert.ok(entries[0].heading.includes("A"));
});

test("splitEntries disambiguates repeated headings by occurrence", () => {
  const { entries } = splitEntries(file(entry("Same"), entry("Same")));
  assert.equal(entries.length, 2);
  assert.notEqual(entries[0].key, entries[1].key);
});

test("an entry only theirs added is merged in", () => {
  const base = file(entry("A"));
  const ours = file(entry("A"), entry("MINE"));
  const theirs = file(entry("A"), entry("YOURS"));
  const r = resolveStages({ base, ours, theirs });
  assert.equal(r.ok, true);
  assert.equal(r.added.length, 1);
  assert.ok(r.text.includes("YOURS"));
  assert.ok(r.text.includes("MINE"));
  assert.ok(r.text.includes("A"));
});

// The false-alarm defect. Both sides carrying byte-identical text for one entry is the NORMAL
// outcome of a lane's finding landing on `main` through a batch PR while the lane branch still
// holds it. There is nothing to choose between, so refusing sends a human to diff two identical
// strings — measured on #2515 and #2502, where the whole "collision" was one trailing blank line.
test("an IDENTICAL edit on both sides is not a collision", () => {
  const base = file(entry("A"));
  const edited = file(entry("A", "FIXED."));
  const r = resolveStages({ base, ours: edited, theirs: edited });
  assert.equal(r.contested.length, 0);
  assert.equal(r.ok, true);
});

test("a genuinely DIVERGENT edit on both sides is still refused", () => {
  const base = file(entry("A"));
  const ours = file(entry("A", "FIXED."));
  const theirs = file(entry("A", "WONTFIX."));
  const r = resolveStages({ base, ours, theirs });
  assert.equal(r.ok, false);
  assert.equal(r.contested.length, 1);
  assert.equal(r.text, null);
});

// The silent-damage defect. A heading fused onto the previous line stops being an entry: the
// splitter reads it as body text, the resolver's own count check still balances (it counts what it
// wrote, and it wrote what it read), and the failure only surfaces later in findings-hygiene.
test("countGlued sees a heading fused onto a previous line", () => {
  const clean = file(entry("A"), entry("B"));
  assert.equal(countGlued(clean), 0);
  const damaged = clean.replace(/\n\n## 2026-08-21 — \[FINDING, P1 test\] B/, "## 2026-08-21 — [FINDING, P1 test] B");
  assert.equal(countGlued(damaged), 1);
});

test("repairGlued restores a fused heading to line start", () => {
  const clean = file(entry("A"), entry("B"));
  const damaged = clean.replace(/\n\n## 2026-08-21 — \[FINDING, P1 test\] B/, "## 2026-08-21 — [FINDING, P1 test] B");
  assert.equal(splitEntries(damaged).entries.length, 1, "damaged input parses as ONE entry — that is the bug");
  assert.equal(splitEntries(repairGlued(damaged)).entries.length, 2);
});

test("damaged input is repaired before it is split, and the repair is reported", () => {
  const base = file(entry("A"));
  const clean = file(entry("A"), entry("B"));
  const ours = clean.replace(/\n\n## 2026-08-21 — \[FINDING, P1 test\] B/, "## 2026-08-21 — [FINDING, P1 test] B");
  const r = resolveStages({ base, ours, theirs: file(entry("A"), entry("C")) });
  assert.equal(r.ok, true);
  assert.ok(r.repaired >= 1, "the repair must be counted, not applied silently");
  const headings = r.text.split("\n").filter((l: string) => l.startsWith("## "));
  assert.equal(headings.length, 3, "A, B and C must all survive as real entries");
});

test("every heading in the output starts a line", () => {
  const r = resolveStages({
    base: file(entry("A")),
    ours: file(entry("A"), entry("B")),
    theirs: file(entry("A"), entry("C")),
  });
  assert.equal(countGlued(r.text), 0);
});
