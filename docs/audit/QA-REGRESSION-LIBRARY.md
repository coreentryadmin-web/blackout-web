# QA regression library

Owned by the QA / Adversarial Product Testing lane (`docs/agents/briefs/qa-adversarial.md`).
Every meaningful production defect this lane finds becomes a reusable entry here — reproduction
steps, root cause, regression scenario, whether automated coverage exists, and production
verification result. **Check new findings against this file before filing them as novel**; a bug
found once should get harder to reintroduce, not merely fixed once.

This file is edited directly by the QA lane (unlike `docs/audit/FINDINGS.md`, which only the
`findings-fold-staging.mjs` script writes to) — it is QA's own working document, not the shared
fold target. A defect still gets a `docs/audit/findings-staging/` entry too, exactly like every
other lane's findings, so it reaches the coordinator and folds into `FINDINGS.md` on the normal
cadence. This file is the QA-specific index on top of that: "have we seen this shape before."

## How to use this file

- Before filing a new finding, scan the table below for the same product + same failure shape.
- After a defect is fixed and independently re-verified live (per `_COMMON.md` rule 6 — merged is
  not done, deployed is not done), update its row's **Verified** column with the date and result.
- A regression scenario is the SPECIFIC repro that would need to hold for the bug to have
  returned — not "test the page again," but "switch expiry 0DTE → Weekly → back to 0DTE and check
  the wall label," so a future pass can mechanically check for recurrence.

## Format

```
### <PRODUCT> — <short title>

| Field | Detail |
|---|---|
| Severity | P0/P1/P2/P3 |
| Found | YYYY-MM-DD |
| Reproduction | numbered steps |
| Root cause | what was actually broken, and why |
| Regression scenario | the specific repro a future QA pass should re-run |
| Automated coverage | test file + name, or "none yet" |
| Findings-staging entry | link to the `docs/audit/findings-staging/` (or folded `FINDINGS.md`) entry |
| Verified live | date + result of the post-fix production retest, or "pending fix" |
```

---

## Entries

_(none yet — Phase 0 interaction sweep in progress; entries land here as real defects are
confirmed, not for routine GREEN passes.)_
