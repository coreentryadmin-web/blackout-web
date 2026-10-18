## 2026-10-18 — [FINDING, test-infra] `benzinga-earnings-pagination.test.ts` crashes in sandbox/CI on an unresolved `POLYGON_API_BASE`, silently truncating the test's own assertion to 1 row

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P2 |
| **Surface** | `src/lib/providers/benzinga-earnings-pagination.test.ts` |

### Symptom

Found while running the full test suite (`npm test`) to validate an unrelated change (a Next.js
security-patch PR) — `fetchBenzingaStructuredEarnings pagination` failed both of its subtests:

```
expected 7, actual 1
expected 21, actual 1
```

Confirmed **not caused by that unrelated change**: reproduced identically in an isolated git
worktree checked out at `origin/main` with completely fresh, independently-installed
dependencies (`npm ci`, no trace of the security PR's `package.json`/`package-lock.json`
changes). This is a real, pre-existing failure already on `main`.

### Root cause

`fetchBenzingaStructuredEarnings`'s pagination loop (`src/lib/providers/polygon.ts`, added
2026-10-18 for the Ask Largo standing mandate's RBLX/SOFI truncation fix) builds
`new URL(nextPath, BASE)` for every page after the first, where `BASE` is
`process.env.POLYGON_API_BASE ?? "https://api.massive.com"`. In this sandbox (and apparently
CI, since the test is part of `npm test`/`verify`), `POLYGON_API_BASE` is set to the **literal,
unresolved string `"POLYGON_API_BASE"`** — the exact `${{shared.*}}`-doesn't-resolve trap
CLAUDE.md documents for several other audit scripts in this repo (e.g. `helix-score-signal.mjs`'s
own note: "this sandbox ships it as the literal unresolved string 'POLYGON_API_BASE'"). `new
URL("/benzinga/v1/earnings?page=1", "POLYGON_API_BASE")` throws `Invalid URL`, which the loop's
own `catch { break; }` swallows generically (indistinguishable from a legitimate network/
entitlement failure) — silently stopping pagination after exactly one page, every time.

The test file already worked around the sibling gotcha (`POLYGON_API_KEY` unset in CI) with an
explicit `process.env.POLYGON_API_KEY = "test-polygon-key"` and a comment citing the established
pattern in `polygon-short-interest-cancellation.test.ts` / `polygon-largo-cancellation.test.ts` —
both of which ALSO explicitly pin `process.env.POLYGON_API_BASE` to a real URL before exercising
Polygon-fetching code, for exactly this reason. This test missed that second half of the same
established pattern.

### Fix

Added `process.env.POLYGON_API_BASE = "https://api.massive.com";` right after the existing
`POLYGON_API_KEY` pin, matching the two sibling test files' precedent exactly. Verified:
- Both subtests pass (`pass 2, fail 0`) on this branch.
- Both subtests ALSO pass when the identical fix is applied against a clean `origin/main` worktree
  with independently-installed dependencies — confirms the fix is correct on its own, not an
  artifact of anything else in this session.

### Deliberately out of scope

The loop's blanket `catch { break; }` (which conflates a real upstream failure with a local
bug like this one) is a separate, smaller code-quality observation, not touched here — the test-env
fix alone restores the test to green and matches the established sibling-file pattern exactly;
widening this into a behavior change in `polygon.ts` itself was not attempted.
