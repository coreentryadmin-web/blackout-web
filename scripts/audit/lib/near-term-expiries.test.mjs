import test from "node:test";
import assert from "node:assert/strict";
import { resolveNearTermExpiriesForAudit } from "./near-term-expiries.mjs";

test("resolveNearTermExpiriesForAudit prefers near_term_expiries over slice fallback", () => {
  const hm = {
    near_term_expiries: ["2026-07-29", "2026-07-30"],
    expiries: ["2026-07-29", "2026-07-30", "2026-09-19", "2026-12-19"],
  };
  const set = resolveNearTermExpiriesForAudit(hm);
  assert.deepEqual([...set], ["2026-07-29", "2026-07-30"]);
});

test("resolveNearTermExpiriesForAudit falls back to sorted slice when field absent", () => {
  const hm = { expiries: ["2026-08-07", "2026-07-29", "2026-07-30"] };
  const set = resolveNearTermExpiriesForAudit(hm, 2);
  assert.deepEqual([...set], ["2026-07-29", "2026-07-30"]);
});
