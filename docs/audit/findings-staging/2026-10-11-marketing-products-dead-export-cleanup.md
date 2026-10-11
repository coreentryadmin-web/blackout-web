## Dead export removed + a second dead export's only reuse opportunity wired up — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | Marketing — `src/lib/marketing/products.ts`, `src/components/landing/HomeLiveDeskStrip.tsx` |
| **Severity** | P4 (dead code / minor duplication, no functional impact) |
| **Status** | FIXED |

### Root cause

A repo-wide grep (`grep -rn "LIVE_MARKETING_PRODUCTS\|marketingProductLearnHref"`) found both
exports from `products.ts` have zero callers outside their own definitions — no production
code, no test. Two different shapes of the same "dead export" problem:

- `marketingProductLearnHref(id)` (a thin `marketingProductById(id)?.learnHref ?? "/learn"`
  wrapper) has genuinely zero call sites anywhere, and no sibling file duplicates its logic
  either — nothing ever needed this exact lookup. Accidental dead code, no retention comment.
- `LIVE_MARKETING_PRODUCTS` (`MARKETING_PRODUCTS.filter((p) => p.launchStatus === "live")`) is
  also uncalled, but **the identical filter expression is duplicated inline** in
  `HomeLiveDeskStrip.tsx:84` (`const modules = MARKETING_PRODUCTS.filter((p) => p.launchStatus
  === "live")`) — a reuse opportunity, not pure dead code: the export existed, a consumer
  needed exactly what it computes, and it re-derived the same thing by hand instead.

### Evidence

`grep -rn` confirmed the zero-caller claim for both exports before any edit. `tsc --noEmit`
clean after removing `marketingProductLearnHref` (nothing referenced it). The existing
`src/lib/marketing/products.test.ts` (7 tests) and `src/components/landing/
HomeLiveDeskStrip.test.ts` (2 tests) both pass unchanged against the refactored code —
confirming the `LIVE_MARKETING_PRODUCTS` swap is behavior-preserving (same source array, same
predicate), not a new risk.

### Blast radius

Just these two files — the same grep that found both exports' zero-caller status covers the
whole repo, not a partial search.

### Fix rationale

- Deleted `marketingProductLearnHref` outright — no reuse site exists for it, so there's
  nothing to wire up; keeping an unused export around invites someone writing a THIRD
  near-duplicate accessor later instead of noticing this one.
- Did **not** delete `LIVE_MARKETING_PRODUCTS` — instead pointed `HomeLiveDeskStrip.tsx` at it,
  removing the duplicated filter expression. This is the smaller, more conservative fix: same
  runtime behavior, one less place the "which products count as live" logic is spelled out.
- Deliberately left `products.test.ts`'s own inline `MARKETING_PRODUCTS.filter((p) =>
  p.launchStatus === "live")` occurrences (lines 12, 22) untouched — those exist specifically
  to independently re-derive the expected value as a test oracle; swapping them to use the
  export they're partly testing against would weaken that independence for no real benefit.

### Test

No new test added — this is a pure mechanical simplification with no behavior change, verified
by the two existing, unmodified test suites above plus a clean `tsc --noEmit`.
