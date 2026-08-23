import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PLAYBOOK_SURFACE_STATUS } from "./playbook-implementation-status";
import type { PlaybookId } from "./playbook-registry";

/**
 * RATCHET: `docs/spx/PLAYBOOK-ARCHITECTURE-STATUS.md` §6 must keep matching the code constant it
 * says it is derived from.
 *
 * WHY THIS EXISTS. That document calls itself the "Single Source of Truth" and tells the reader to
 * "start here for current truth". Audited 2026-08-22 at `9b20b63c`, its §6 matrix was in fact
 * accurate — all 70 cells matched `PLAYBOOK_SURFACE_STATUS` — while the SAME document's
 * environment claims had rotted completely (a repo that is not this one, a host decommissioned
 * 2026-07-25, a warning about a "Railway prod" that does not exist, and a validation command
 * removed from package.json).
 *
 * So the failure mode is not "the doc is wrong". It is that a doc can be RIGHT about the code and
 * WRONG about the world in the same paragraph, and nothing tells a reader which half they are
 * looking at. The half that CAN be checked mechanically now is, so it cannot join the other half.
 *
 * This is the same shape as the C1 session-anchor ratchet and `findings-hygiene.test.ts`: an
 * invariant a human would otherwise have to re-verify by hand every time, and would eventually
 * stop verifying.
 *
 * If this test fails, the fix is to update whichever side is stale — never to delete the table.
 */

const DOC = "docs/spx/PLAYBOOK-ARCHITECTURE-STATUS.md";
const COLUMNS = [
  "matcher",
  "fsm_persistence",
  "allowlist_gate",
  "exit_management",
  "production_eligible",
] as const;

/** Parse the §6 matrix rows: `| PB-01 | Name | subtype | matcher | fsm | allowlist | exit | prod | notes |` */
function parseDocMatrix(md: string): Map<string, string[]> {
  const rows = new Map<string, string[]>();
  for (const line of md.split("\n")) {
    const m = /^\|\s*(PB-\d\d)\s*\|(.+)\|\s*$/.exec(line.trim());
    if (!m) continue;
    const cells = m[2].split("|").map((c) => c.replace(/\*\*/g, "").trim());
    // cells: [name, subtype, matcher, fsm, allowlist, exit_mgmt, prod_eligible, notes?]
    if (cells.length < 7) continue;
    rows.set(m[1], cells.slice(2, 7));
  }
  return rows;
}

test("PLAYBOOK-ARCHITECTURE-STATUS §6 matrix matches PLAYBOOK_SURFACE_STATUS", () => {
  const doc = parseDocMatrix(readFileSync(DOC, "utf8"));

  // A parse that silently finds nothing would pass every assertion below — the exact
  // absence-reads-as-clean failure this repo keeps paying for.
  assert.equal(doc.size, 14, `expected 14 PB rows parsed from ${DOC} §6, got ${doc.size}`);

  const mismatches: string[] = [];
  for (const [id, cells] of doc) {
    const code = PLAYBOOK_SURFACE_STATUS[id as PlaybookId];
    assert.ok(code, `${id} is in the doc but not in PLAYBOOK_SURFACE_STATUS`);
    COLUMNS.forEach((col, i) => {
      if (cells[i] !== code[col]) {
        mismatches.push(`${id}.${col}: doc="${cells[i]}" code="${code[col]}"`);
      }
    });
  }
  assert.deepEqual(
    mismatches,
    [],
    `${DOC} §6 has drifted from PLAYBOOK_SURFACE_STATUS. Update whichever side is stale:\n  ` +
      mismatches.join("\n  ")
  );
});

test("every registered playbook appears in the doc matrix — no silent omissions", () => {
  const doc = parseDocMatrix(readFileSync(DOC, "utf8"));
  for (const id of Object.keys(PLAYBOOK_SURFACE_STATUS)) {
    assert.ok(doc.has(id), `${id} exists in code but is missing from ${DOC} §6`);
  }
});

test("production_eligible is DESCRIPTIVE — this test records that, so its meaning cannot drift silently", () => {
  // Measured 2026-08-22: nothing outside playbook-implementation-status.ts reads
  // `production_eligible`, or `PLAYBOOK_SURFACE_STATUS` at all. Every one of the 14 playbooks is
  // marked "not_started", which reads as a hard safety gate — while PLAYBOOK_LIVE_GATE="1" in
  // production means gate A17 requires a matched primary playbook before any BUY. So playbooks DO
  // decide live entries, and this field does not stop them.
  //
  // The assertion is deliberately weak: it pins the CURRENT value so that a future change to
  // gating (or to these statuses) has to come past this comment. It is not a claim that
  // "not_started" is correct.
  const all = Object.values(PLAYBOOK_SURFACE_STATUS);
  assert.equal(all.length, 14);
  assert.ok(
    all.every((s) => s.production_eligible === "not_started"),
    "all 14 are production_eligible:not_started — if this changed, revisit whether the field now gates anything"
  );
});
