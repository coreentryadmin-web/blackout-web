> **kind:** FINDING

## 2026-11-04 — verify red: catalystsSection short-vol test used ancient as_of — FIXED

| **Status** | FIXED on `fix/play-brief-short-vol-test-as-of` |
| --- | --- |

**Symptom:** `verify` on `main` @ `232c0459` failed: `catalystsSection: short vol ratio renders...` — `assert.ok(section)` because fixture `as_of: 2026-09-05` crossed fundamentals ancient ceiling by Nov 2026.

**Fix:** Use rolling `recentAsOf` (3 days ago) like sibling catalystsSection tests.
