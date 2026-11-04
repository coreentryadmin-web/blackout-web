> **kind:** FINDING

## catalystsSection short-vol audit test date-bombed on wall clock — FIXED

| | |
|---|---|
| **Area** | `src/lib/swing/play-brief-intel.test.ts` |
| **Status** | FIXED |
| **Severity** | CI only (verify red on main `232c0459`) |

Fixture `fundamentals.as_of: 2026-09-05` with no `readMs` anchor crossed
`fundamentalsAncient` once real time passed ~60d later; `catalystsSection` returned null and
`assert.ok(section)` failed. Pinned `readMs` to 2026-09-10 like sibling catalyst tests.
