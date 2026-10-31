> **kind:** FINDING

## HelixContextHeader: an UNKNOWN/typeless `option_type` was silently fabricated into call premium — FIXED

**Status:** Fixed, regression tests added (`src/features/helix/components/HelixContextHeader.test.ts`).

### Root cause

`FlowAlert.option_type` is declared as a bare `string` in `src/lib/api.ts`, not a
`"CALL" | "PUT"` union — a real, already-handled case elsewhere in this exact feature, not a
theoretical one. Two sibling panels carry an explicit `gap-#6` rule for it:

- `FlowFeed.tsx`'s sector-rotation aggregator (`sectorFlowEntries`):
  `if (option_type === "CALL") ...; else if (option_type === "PUT") ...;` with the comment
  "UNKNOWN/typeless prints count toward NEITHER side (never fabricate a put)".
- `NetPremiumLeaderboard.tsx`: the identical explicit `if (CALL) ... else if (PUT) ...` shape,
  same `gap-#6` comment.

`HelixContextHeader.tsx`'s `summarizeHelixTapeContext` — the ticker-scoped session-context
summary rendered above the flow tape (spot, IV, call/put premium, PCR, top score) — never
received the same fix. Its loop read:

```ts
if (a.option_type?.toUpperCase() === "PUT") putPremium += prem;
else callPremium += prem;
```

Any print whose `option_type` was not exactly `"PUT"` (case-insensitive) — including an empty
string, a null-ish/missing value coerced through `?.toUpperCase()`, or a genuinely unknown
classification from upstream — was counted as a CALL by the bare `else`. This fabricates call
premium out of prints the tape could not classify at all, which inflates both the
`Call Premium` / `Put Premium` figures the header renders (`fmtPremium(summary.callPremium)`)
and the derived PCR (`pcr = putPremium / (callPremium + putPremium)`) shown next to them —
the exact defect shape the `gap-#6` comment elsewhere in this same feature was written to
prevent.

### Evidence

- New tests in `HelixContextHeader.test.ts`:
  - An `"UNKNOWN"`-typed $1,000,000 print mixed with a $100,000 CALL and a $50,000 PUT: before
    the fix, `callPremium` read `1,100,000` (the UNKNOWN print silently absorbed into CALL);
    after the fix, `callPremium` reads the correct `100,000`.
  - An empty-string-typed $500,000 print alongside a $10,000 PUT: before the fix,
    `callPremium` read `500,000`; after the fix, `0`.
  - A case-insensitivity check (`"call"`/`"put"` lowercase) confirms the existing
    case-insensitive matching is preserved, not just a side effect of the fix.
- **RED (pre-fix, via `git stash` on `HelixContextHeader.tsx` only, keeping the new test
  file):** both repro tests failed exactly as predicted —
  `1100000 !== 100000` and `500000 !== 0` — the third (case-insensitivity) test passed, as
  expected since that behavior was never broken.
- **GREEN (fix restored):** 3/3 tests in `HelixContextHeader.test.ts` pass.
- Full blast-radius re-run: every `*.test.ts`/`*.test.tsx` file in
  `src/features/helix/components/` — 50/50 pass.
- `npx tsc --noEmit` clean on the whole project.

### Blast radius

`summarizeHelixTapeContext` is defined and consumed only inside `HelixContextHeader.tsx`
(confirmed via a repo-wide grep for the symbol name) — the fix's only call site. No other
panel reads this function; `NetPremiumLeaderboard.tsx` and `FlowFeed.tsx`'s sector aggregator
already had the correct shape and are unaffected (verified unchanged, re-read, not re-fixed).

### Fix rationale

Mirrored the exact `gap-#6` pattern already shipped twice in sibling panels in the same
feature directory: classify explicitly with `if (CALL) ... else if (PUT) ...`, leaving any
other value in neither bucket, rather than inferring one side from the absence of the other.
This is the minimal, already-proven-correct fix for this exact bug shape — no new concept
introduced, just consistency with code that sits a few files away in the same directory.

### Deliberately left unchanged

- `dte0Count`/`chainOi`/`spot`/`iv`/`topScore` — none of these fields depend on
  `option_type` classification and were already correct.
- `NetPremiumLeaderboard.tsx` / `FlowFeed.tsx`'s sector-rotation aggregator — already carry the
  correct `gap-#6` shape; re-verified, not re-fixed.
