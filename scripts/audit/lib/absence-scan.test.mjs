import { strict as assert } from "node:assert";
import test from "node:test";
import { findCountableEmpties, stripNonCode } from "./absence-scan.mjs";

test("an unavailable payload carrying a zero is flagged", () => {
  const sites = findCountableEmpties(`
    return { available: false, reason: "db_down", blocked_total: 0 };
  `);
  assert.equal(sites.length, 1);
  assert.deepEqual(sites[0].empties, ["blocked_total: 0"]);
});

test("an unavailable payload carrying an empty list is flagged", () => {
  const sites = findCountableEmpties(`return { available: false, plays: [] };`);
  assert.deepEqual(sites[0].empties, ["plays: []"]);
});

test("a MEASURED empty is NOT flagged — that one is a real answer", () => {
  // The whole point of keying on `available: false`: a quiet session must never trip this.
  assert.deepEqual(findCountableEmpties(`return { available: true, plays: [] };`), []);
});

test("an unavailable payload with nothing countable is clean", () => {
  assert.deepEqual(
    findCountableEmpties(`return { available: false, reason: "db_down", note: "nothing was read" };`),
    []
  );
});

test("a null count is clean — null is the fix, not the defect", () => {
  assert.deepEqual(
    findCountableEmpties(`return { available: false, blocked_total: null, graded_total: null };`),
    []
  );
});

test("prose ABOUT the defect is not the defect", () => {
  // tool-defs.ts documents this exact class in a description string, and an earlier draft of this
  // scanner flagged its own documentation. A guard that cannot tell code from commentary trains
  // people to ignore it.
  const src = `
    // available: false with plays: [] is the bug this exists to catch
    /* another mention: available: false, blocked_total: 0 */
    const desc = "returns available: false and plays: [] on a failed read";
    export const ok = 1;
  `;
  assert.deepEqual(findCountableEmpties(src), []);
});

test("stripNonCode leaves real code intact", () => {
  const out = stripNonCode(`const x = 1; // trailing\nreturn { available: false, plays: [] };`);
  assert.match(out, /available:\s*false/);
  assert.match(out, /plays:\s*\[\]/);
  assert.doesNotMatch(out, /trailing/);
});

test("a URL inside code is not mistaken for a line comment", () => {
  // `//` after a colon is the http:// case — eating the rest of that line would hide a real site.
  const sites = findCountableEmpties(`const u = http://x; \n return { available: false, plays: [] };`);
  assert.equal(sites.length, 1);
});

test("the report names the line so a reader can go straight to it", () => {
  const sites = findCountableEmpties(`\n\n\nreturn { available: false, plays: [] };`);
  assert.equal(sites[0].line, 4);
});
