> **kind:** FINDING

## Largo pre-earnings desk pack has a `history_error` for print history but no equivalent for the next-earnings date itself — FIXED

| | |
|---|---|
| **Area** | `src/lib/largo/pre-earnings-pack.ts`'s `preEarningsPackForLargo` — the Largo chat tool-use prefetch (`src/lib/largo-terminal.ts`) and the Meridian earnings event-detail panel (`src/lib/meridian/meridian-earnings-event-load.ts`) |
| **Status** | FIXED |
| **File** | `src/lib/largo/pre-earnings-pack.ts`, `src/lib/largo-terminal.ts` |

### Root cause

This is the disclosed, not-yet-fixed follow-up named in the same-day finding
`docs/audit/findings-staging/2026-11-08-bie-earnings-absence-mislabels-fetch-failure.md` (PR #7584,
merged) — same absence-vs-fabricated-certainty bug shape, a second independent occurrence rather
than a duplicate.

`preEarningsPackForLargo` runs two Benzinga reads in parallel: `loadBenzingaTickerEarnings` (the
primary 6-print fetch, also used to derive `resolvedDate`/history) and the independent
`loadNextEarningsFromBenzinga` (fixed earlier the same day by PR #7584 to carry a calendar-fetch
failure forward as `{..., error: res.error}` instead of discarding it as a bare `null`). It then
computed:

```ts
const parsedNext = parseNextEarningsFromBenzinga(t, benzingaRes.rows, today);
const next = parsedNext ?? nextEarnings;
```

When the live Benzinga entitlement 403 (CLAUDE.md's "ENTITLEMENT REGRESSED 2026-11-07" note) fires,
`benzingaRes.rows` is `[]` and `benzingaRes.error` is a real string (e.g.
`"benzinga_ticker_earnings:not_entitled"`). `parsedNext` is then `null` (nothing to parse from an
empty row set), so `next` falls back to `nextEarnings` — which, since PR #7584, correctly carries
`error: "benzinga_ticker_earnings:not_entitled"`. But **neither `benzingaRes.error` nor `next?.error`
was ever read** anywhere in this function. The returned card had no field to carry either one, so
every consumer saw a plain `earnings_date: null, days_until: null, report_time: null,
is_confirmed: null` — structurally identical to a genuinely quiet calendar — with zero signal that
the lookup itself had failed. The sibling field three lines below it in the same returned object,
`history_error`, already does this correctly for print history; the next-earnings-date leg simply
never got the same treatment.

### Evidence

**Confirmed by reading the current source** (commit `110d7caae`, the tip this fix branched from):
`benzingaRes.error` and `next?.error` (now present on `NextEarnings` since PR #7584) are both in
scope at the point `next` is computed, and neither appears anywhere else in the function body or in
the returned object — grep for `.error` inside `preEarningsPackForLargo` pre-fix returns zero hits
outside the untouched `historyRes.history_error` line.

**RED → GREEN proof:** added `src/lib/largo/pre-earnings-pack.test.ts` (did not exist before this
fix) with 3 cases, then isolated the source fix with a worktree-safe temporary stash
(`git stash push -u -- src/lib/largo/pre-earnings-pack.ts`, captured by SHA, restored with
`git stash apply <sha>` — never a bare `stash pop`, per this sandbox's shared-stash-stack rule) and
re-ran the new test file against the unfixed source:

- **Pre-fix: 0 pass / 3 fail** — every test fails with
  `Cannot find module '.../src/lib/largo/@/lib/providers/gex-positioning'`. This is the correct
  failure mode for this fix specifically: making `preEarningsPackForLargo` testable at all required
  switching its two `Promise.all`-wrapped dynamic imports (`@/lib/providers/gex-positioning`,
  `@/lib/platform`) and `boardExposure`'s own dynamic import (`@/lib/platform/zerodte-service`) from
  `"@/..."` path aliases to relative specifiers — tsx does not rewrite path aliases for a dynamic
  `import()` call or for `mock.module()`'s own specifier, only for a statically-parsed top-level
  import (confirmed precedent: `src/lib/bie/ecosystem-context.ts` made the identical change for its
  own dynamic import of `spx-desk-convergence`, documented in that file's own test). Without that
  refactor, this card could never be unit-tested at all, with or without the `earnings_error` fix.
- **Post-fix (stash restored): 3 pass / 0 fail.**

Full regression runs (Node 20, `--experimental-test-module-mocks`):
- `src/lib/largo/pre-earnings-pack.test.ts`: **3/3 pass** (new file).
- `src/lib/largo-terminal.test.ts`: **16/16 pass** (consumes `preEarningsPackForLargo` behind its
  own mock; unaffected by the additive field or the prompt-text sentence).
- `src/lib/meridian/meridian-benzinga-earnings.test.ts` + `src/lib/bie/ecosystem-context.test.ts`
  (both touch the same `NextEarnings`/Benzinga surface this fix reads from): **71/71 pass**
  (combined with the above three files in one run).
- `npx tsc --noEmit`: clean — `earnings_error` is additive, so every existing consumer of
  `PreEarningsPackCard` (`LargoPreEarningsPackCard.tsx`, `LargoStructuredCards.tsx`,
  `LargoAnswerMessage.tsx`, `meridian-earnings-intel.ts`, `meridian-types.ts`, `api.ts`,
  `useLargoChat.ts`) type-checks unchanged with zero edits.

### Blast radius

Two live consumers read `preEarningsPackForLargo`'s output:

- `src/lib/largo-terminal.ts` (~line 739): calls it inside the Largo chat tool-use flow with
  `.catch(() => null)`, then dumps the whole card as raw JSON into the system prompt with an
  explanatory caveat sentence for `history_error` but — until this fix — nothing for the
  next-earnings-date leg, so the model had no way to know a null `earnings_date` might just mean
  "we could not look." Fixed here by adding one sentence to that same caveat block, matching its
  existing style.
- `src/lib/meridian/meridian-earnings-event-load.ts` (~line 53): `loadMeridianEarningsEventDetail`
  calls `preEarningsPackForLargo` directly inside an unguarded `Promise.all`, feeding the Meridian
  earnings event-detail panel. **Deliberately not touched by this fix** — confirmed
  `preEarningsPackForLargo` itself does not currently throw (every one of its awaited sub-calls
  already has its own internal `.catch()` guard), so there is no live 502 risk this fix needs to
  address; this consumer simply receives the new `earnings_error` field for free, additively, with
  no code change required on its side.

No UI component was touched (`LargoPreEarningsPackCard.tsx` and siblings keep rendering exactly as
before — `earnings_error` is a new field nothing reads yet, matching this fix's requested scope).
`history_error`'s own behavior is unchanged.

### Fix rationale

Mirrors `history_error`'s already-correct, already-shipped pattern on the same card rather than
inventing a new shape: a new optional `earnings_error: string | null` field, computed once as
`benzingaRes.error ?? next?.error ?? null` (the primary 6-print fetch's own error wins first, since
it also derives `resolvedDate`/history; the independent `loadNextEarningsFromBenzinga` call's error
is the fallback, read only when the primary fetch came back clean), and surfaced to the model via
one added sentence in the existing `largo-terminal.ts` prompt caveat block. Left
`meridian-earnings-event-load.ts`'s error-handling shape and `parseNextEarningsFromBenzinga`'s own
signature untouched, per this fix's scope — the former is a separately-disclosed, not-fixed-here
observation (no live throw risk found), the latter already serves two other call sites correctly
and widening it was unnecessary for this fix.
