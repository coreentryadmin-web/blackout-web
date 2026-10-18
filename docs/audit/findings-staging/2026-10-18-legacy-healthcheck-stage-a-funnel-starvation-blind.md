## 2026-10-18 — [FINDING, tooling] `legacy-e2e-healthcheck.mjs` Stage A (EDITION) can't distinguish a genuinely quiet market from a starved dossier/scoring funnel — reported GREEN through a real P0 for over a day

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P1 (standing-mandate audit gap — the Legacy healthcheck is the pre-open RED/GREEN gate for this lane) |
| **Surface** | `scripts/audit/legacy-e2e-healthcheck.mjs` Stage A, `scripts/audit/lib/legacy-healthcheck-eval.mjs::verdictForEdition` |

### Symptom

`verdictForEdition`'s `noPlays` branch returned a flat `{verdict: 'GREEN', evidence: 'published
edition, honestly zero plays this session'}` for EVERY honest-zero-plays edition, with no way to
tell apart:

- a **genuinely quiet market** (nothing worth screening, or candidates existed and were
  legitimately ranked/scored down to zero) — a real GREEN, and
- a **starved funnel** (real candidates existed but the dossier/scoring stage never ranked a single
  one of them) — a real pipeline failure that happens to also produce `plays: []`.

`checkEdition()` never even extracted the edition response's own `funnel` field (top-level
`EditionFunnelCounts` — `candidates`/`ranked`/etc., `src/features/nighthawk/lib/edition-funnel.ts`)
at all, so the data needed to tell the two apart was sitting in the response, unread.

### Confirmed-live impact

This gap let a real incident go undetected by the standing healthcheck for over a day: Monday
2026-10-19's digest board was empty with **20 real candidates and 0 scored dossiers** (a starved
funnel, not a quiet market) and `recap_only` published — and Stage A still reported a clean GREEN
for that entire window, because the `noPlays` branch short-circuited before anything downstream of
discovery was ever examined.

### Root cause

`checkEdition()` in `scripts/audit/legacy-e2e-healthcheck.mjs` built its verdict input from
`{fetchOk, available, stale, degraded, playsCount, noPlays}` only. `verdictForEdition()` in
`scripts/audit/lib/legacy-healthcheck-eval.mjs` had no parameter to receive funnel data in the
first place, so even if the runner had read `res.json?.funnel`, the eval function had nowhere to
put it.

### Fix

- `checkEdition()` now extracts the edition response's top-level `funnel` object and forwards
  `funnel.candidates`/`funnel.ranked` (as `funnelCandidates`/`funnelRanked`) into
  `verdictForEdition()`.
- `verdictForEdition()`'s `noPlays` branch now checks: if `funnelCandidates > 0` AND
  `funnelRanked === 0` (both present as numbers), report **RED** — "published edition with zero
  plays, but funnel shows N candidate(s) and 0 ranked — starved funnel, not a quiet market" —
  naming the exact candidate count. Otherwise (candidates===0, or candidates>0 with some ranked, or
  funnel data absent/non-numeric — an older/partial payload shape) it falls through to the
  original, unchanged GREEN. This is a strict widening: it can only turn a GREEN into a RED when
  the funnel data itself proves candidates existed and none were ever ranked, never the other
  direction, so the honest-quiet-market case is not regressed.

### Fix rationale

Chose RED over AMBER because this is the exact failure class Stage A exists to catch for this
lane's pre-open gate — a starved dossier/scoring stage is a pipeline defect, not a degraded-but-
functioning state, and the existing convention in this file (`verdictForRecord`'s bucket-sum
mismatch, `verdictForMarkRow`'s crossed book) already reserves RED for "the payload itself proves
something is structurally wrong," which this is. AMBER is reserved elsewhere in this file for
honest-but-incomplete states (no edition published yet, stale, missing segment) where the payload
is self-consistent but just early/partial — that's not this case.

### Evidence (RED→GREEN proof)

Added 4 new unit tests to `scripts/audit/lib/legacy-healthcheck-eval.test.mjs`. Pre-fix (confirmed
by temporarily reverting just the eval file to its pre-fix `HEAD` content and re-running against
the new tests): 48 pass / **1 fail** — the new starved-funnel case (`funnelCandidates: 20,
funnelRanked: 0`) asserted `RED` but the pre-fix code returned `GREEN`. Post-fix: all 49 tests pass,
including the pre-existing honest-zero-plays-GREEN case (unchanged) and the new
"candidates-ranked-to-zero-legitimately" and "no funnel data at all" cases (both still GREEN, per
the no-regression requirement).

Ran on Node 20 (`/opt/node20/bin/node`, v20.20.2):
```
npx tsx --experimental-test-module-mocks --test scripts/audit/lib/legacy-healthcheck-eval.test.mjs
# tests 49, pass 49, fail 0
```
`npx tsc --noEmit` on Node 20: clean, no output.

### Blast radius

Only these two files change: the runner (`legacy-e2e-healthcheck.mjs`) and the pure eval library
(`legacy-healthcheck-eval.mjs`) + its test file. No other caller of `verdictForEdition` exists in
the repo (grep-confirmed) and the new parameters are optional/additive, so no other call site needs
updating.
