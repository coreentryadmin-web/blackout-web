> **kind:** FINDING

## verify red: catalystsSection audit #12 test used fixed as_of past fundamentals ancient ceiling

| **Status** | FIXED |

### What was broken

`catalystsSection: short vol ratio renders as a sane percent (audit #12)` used `fundamentals.as_of: "2026-09-05"`. As wall-clock time passed, that crossed `FUNDAMENTALS_ANCIENT_CEILING_MS` (60d), so `catalystsSection` omitted fundamentals entirely and `assert.ok(section)` failed on `main@232c0459` verify.

### Fix

Use a rolling `freshAsOf` (~10d ago) in the test — the assertion targets `0.6913 → 69%` formatting, not ancient omission (covered by the Largo C3 test).

### Verify

`node --import tsx --test src/lib/swing/play-brief-intel.test.ts` — audit #12 subtest passes.
