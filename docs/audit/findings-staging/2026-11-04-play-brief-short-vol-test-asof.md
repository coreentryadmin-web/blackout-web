> **kind:** FINDING

## verify red: catalystsSection short-vol test used fixed as_of now ancient — FIXED

| | |
|---|---|
| **Area** | `src/lib/swing/play-brief-intel.test.ts` |
| **Status** | FIXED |
| **Severity** | CI only (test date bomb, not production regression) |

### Root cause

`catalystsSection` omits fundamentals when `fundamentalsAncient(as_of)` is true (Largo C3). The audit #12 test pinned `as_of: "2026-09-05"`; by Nov 2026 that read is ancient, `catalystsSection` returned `null`, and `assert.ok(section)` failed on `main` @ `232c0459`.

### Fix

Use a rolling `recentAsOf` (~3 days ago), same pattern as sibling catalystsSection freshness tests.

### Verification

`npx tsx --test src/lib/swing/play-brief-intel.test.ts --test-name-pattern "short vol ratio"`
