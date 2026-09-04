import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { nightlyStressBankForDate } from "../scripts/largo-stress-nightly-bank.mjs";

test("nightlyStressBankForDate rotates 1..4 across consecutive UTC days", () => {
  const banks = [1, 2, 3, 4, 1].map((expected, i) =>
    nightlyStressBankForDate(new Date(`2026-01-0${i + 1}T06:30:00.000Z`))
  );
  assert.deepEqual(banks, [1, 2, 3, 4, 1]);
});

test("nightly-stress workflow rotates banks and sets concurrency (not all-banks nightly)", () => {
  const src = readFileSync(
    join(import.meta.dirname, "..", ".github", "workflows", "largo-stress-nightly.yml"),
    "utf8"
  );
  assert.match(src, /largo-stress-nightly-bank\.mjs/, "expected nightly bank rotation script");
  assert.match(src, /LARGO_STRESS_CONCURRENCY/, "expected explicit concurrency for nightly scope");
  assert.ok(
    !/LARGO_STRESS_BANK:\s*all/.test(src),
    "nightly schedule must not run all 523 questions inside a 45-minute job"
  );
});
