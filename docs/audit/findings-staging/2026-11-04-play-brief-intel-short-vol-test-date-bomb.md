> **kind:** FINDING

## play-brief-intel short vol ratio test date bomb — FIXED

| **Status** | Fixed — use rolling recent `as_of` in test fixture |
| **Area** | `src/lib/swing/play-brief-intel.test.ts` |
| **Severity** | CI `verify` red on `232c0459` |

**What was broken:** `catalystsSection: short vol ratio…` used fixed `as_of: "2026-09-05"`. After calendar drift past `FUNDAMENTALS_ANCIENT_CEILING_MS` (60d), `fundamentalsAncient` omitted the block → `section === null` → `assert.ok(section)` failed.

**Fix:** `recentAsOf` rolling 5 days before `Date.now()` (same pattern as sibling catalysts tests).

**Verify:** `node --import tsx --test src/lib/swing/play-brief-intel.test.ts` — short vol subtest green.
