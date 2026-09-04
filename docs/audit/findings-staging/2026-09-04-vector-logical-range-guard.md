# Vector chart logical-range guard — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **What prompted this** | Sentry production sample (2026-09-03): `Error: Uncaught Error: Assertion failed: right should be >= left` from lightweight-charts when restoring or applying a visible logical range during background chart updates. |
| **Root cause** | `getVisibleLogicalRange()` can briefly return an inverted `{from, to}` during bar-count transitions; callers passed it straight to `setVisibleLogicalRange()` with no validation. |
| **Fix** | `normalizeLogicalRange()` rejects non-finite or inverted ranges; `applyVisibleLogicalRange()` centralizes the guard at every `setVisibleLogicalRange` call site in Vector chart surfaces. |
| **Status** | FIXED |
