> **kind:** FINDING

## verify: catalystsSection short-vol test crossed fundamentals ancient ceiling — FIXED

| **Status** | FIXED |

**Symptom:** CI `verify` on `232c0459`: `catalystsSection: short vol ratio…` failed — `assert.ok(section)` because `fundamentalsAncient("2026-09-05")` became true once wall clock passed 60d after that date.

**Fix:** Pass anchored `readMs` (`2026-10-15`) into `catalystsSection` so the fixture `as_of` stays inside the omission window.

**Verify:** `npx tsx --test src/lib/swing/play-brief-intel.test.ts --test-name-pattern "short vol ratio"`
