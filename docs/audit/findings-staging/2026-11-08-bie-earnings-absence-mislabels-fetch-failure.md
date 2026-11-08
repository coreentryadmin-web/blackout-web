> **kind:** FINDING

## BIE ecosystem-context "earnings" absence leg mislabels a failed calendar fetch as a confident, non-retryable "no upcoming date" — FIXED

| | |
|---|---|
| **Area** | BIE #60 data arsenal — `assembleEcosystemArsenal`'s single-name "earnings" leg (consumed by Largo's ecosystem-context tool-use surface, Night Hawk Swings play-brief, and every other composer that reads `ctx.ecosystem.arsenal`) |
| **Status** | FIXED |
| **File** | `src/lib/providers/uw-earnings.ts` (`NextEarnings`, `fetchNextEarningsDate`), `src/lib/meridian/meridian-benzinga-earnings.ts` (`loadNextEarningsFromBenzinga`), `src/lib/bie/ecosystem-context.ts` (`assembleEcosystemArsenal`) |

### Root cause

The earnings leg had a real, currently-live upstream fetch failure to disclose — the already-
documented Benzinga entitlement outage (CLAUDE.md, "⚠️ ENTITLEMENT REGRESSED 2026-11-07": every
Benzinga call 403s "You are not entitled to this data") — but every layer between the raw fetch and
the member-facing envelope discarded the failure signal instead of carrying it forward, in contrast
to the sibling "news" leg a few lines below it in the same file, which already does this correctly
via `NewsResult.unavailable`.

The discard happened at three stacked layers:

1. `loadBenzingaTickerEarnings` (`meridian-benzinga-earnings.ts`) correctly THROWS on a provider
   error so its cache never stores a failure as an indistinguishable empty result (a prior,
   separate 2026-08-18 fix), and its `.catch()` carries the real message forward as `res.error`.
2. Its sibling `loadNextEarningsFromBenzinga` called `parseNextEarningsFromBenzinga(sym, res.rows,
   today)` and returned whatever came back — `res.error` was read nowhere. An empty `rows` array
   (whatever its cause: a real empty calendar, or a 403 that returned zero rows) collapsed to the
   same bare `null` either way.
3. `NextEarnings` (`uw-earnings.ts`) had no error field at all, so there was structurally nowhere
   to carry a failure signal through this type even if a caller wanted to — `fetchNextEarningsDate`
   wrapped a `.catch(() => null)` around the Benzinga call and a UW REST fallback, with no way to
   distinguish "neither source has anything" from "neither source could be read."
4. `assembleEcosystemArsenal`'s earnings branch (`ecosystem-context.ts`) treated `reads.earnings
   === null` (or a falsy `earnings_date`) as a single case and unconditionally emitted
   `{reason: "no upcoming date", retryable: false}` — a confident, non-retryable claim that is only
   true for a genuinely empty calendar, not for a calendar that failed to load. The push site's own
   inline comment explicitly (and, under the live outage, incorrectly) asserted this was
   "structural" and that "retrying... returns the same nothing."

This is the same absence-vs-fabrication shape `docs/audit/LARGO-PRODUCT-CONTRACT.md` names for
`confidence` ("must be OMITTED when a product cannot calibrate it... fabricated certainty...
corrupts cross-product ranking") applied to an absence *reason* instead of a confidence score: an
honest "we don't know, try again" was replaced by a fabricated, confident "there is nothing here."

### Evidence

**Live reproduction (2026-11-08):** `GET /api/market/swing/play-brief?playId=BANGER:CAVA&ticker=CAVA&positionId=2483&status=OPEN`
(CAVA Group — a real NYSE restaurant chain with regular quarterly earnings, confirmed via `GET
/v3/reference/tickers?ticker=CAVA` returning `type: "CS"`, not an ETF) returned `unavailableSources`
carrying `{"source":"earnings","reason":"no upcoming date","what_is_missing":"a scheduled earnings
date for this ticker","retryable":false}` — while the SAME response's "news" leg on the SAME ticker
correctly disclosed the real failure as `retryable: true`. Direct reproduction against the Benzinga
earnings endpoint itself (`curl https://api.massive.com/benzinga/v1/earnings?ticker=CAVA&date.gte=...`)
returned HTTP 403 with the exact "not entitled" error body — confirming the "no upcoming date" claim
was fabricated, not measured.

**RED → GREEN proof:** added two new regression tests (one per affected layer) and reverted only
the three fixed source files (`git checkout <parent-commit> -- <3 files>`, tests left untouched),
then re-ran both affected suites:

- Pre-fix: **53 pass / 2 fail** — exactly the two new tests fail
  (`loadNextEarningsFromBenzinga: a FAILED fetch ... carries the real error instead of a bare null`
  and `assembleEcosystemArsenal: a FAILED earnings-calendar fetch is retryable:true with the real
  cause, not the generic 'no upcoming date'`); every pre-existing test, including the ones proving
  the genuine clean-absence case still returns `null`/`retryable:false`, continues to pass
  unchanged.
- Post-fix (restored): **55/55 pass.**

Full suite runs:
- `npx tsx --experimental-test-module-mocks --test src/lib/meridian/meridian-benzinga-earnings.test.ts src/lib/bie/ecosystem-context.test.ts`: **55/55 pass.**
- `npx tsx --experimental-test-module-mocks --test src/lib/nighthawk/cortex/fetch.test.ts src/lib/providers/uw-earnings.test.ts src/lib/meridian/meridian-benzinga-earnings-core.test.ts src/lib/largo/run-tool.test.ts`: **77/77 pass** (every other known consumer of `NextEarnings`/`fetchNextEarningsDate`, unaffected).
- `src/lib/largo-terminal.test.ts` (consumes `pre-earnings-pack.ts`, which itself has a related, separately-noted gap below): **16/16 pass.**
- `npx tsc --noEmit`: clean.

### Blast radius

`NextEarnings.error` is a new, optional field — every existing consumer of `NextEarnings` that
doesn't read it (`src/lib/largo/run-tool.ts`, `src/lib/largo/pre-earnings-pack.ts`,
`src/lib/nighthawk/cortex/fetch.ts`, `src/lib/bie/verdict.ts`) is unaffected; none of their own
tests needed a change (confirmed above). `parseNextEarningsFromBenzinga`
(`meridian-benzinga-earnings-core.ts`) was deliberately left untouched — the error-threading happens
one layer up, in `loadNextEarningsFromBenzinga`, specifically so its two other direct callers
(`pre-earnings-pack.ts`'s `preEarningsPackForLargo`, `run-tool.ts`'s `get_earnings` tool) keep their
exact current behavior with zero changes required.

**Confirmed via grep: `fetchNextEarningsDate`/`NextEarnings` callers beyond `ecosystem-context.ts`,
checked and left unchanged (not needing this fix's new field, per their own existing designs):**
- `src/lib/bie/verdict.ts` (`fetchNextEarningsDate` behind a `safe()` wrapper for the #59 verdict
  engine) — reads only `earnings_date`/`days_until`-shaped fields for its own scoring; unaffected.
- `src/lib/nighthawk/cortex/fetch.ts` — takes an injected `fetchNextEarningsDate` function and reads
  the result as `NextEarnings | null` for Cortex evidence; unaffected (an optional field it never
  reads).
- `src/lib/largo/run-tool.ts`'s `get_earnings` tool — calls `parseNextEarningsFromBenzinga` directly
  (not `loadNextEarningsFromBenzinga`) and **already carries its own separate `calendar_error`**
  field (`calendar.error ?? history.history_error`) alongside `next_report` — this call site never
  had the bug this fix addresses; it independently solved the same problem correctly already.

**Found, NOT fixed here (separate, pre-existing absence leg with the same mismatch shape, out of
this fix's scope per the task's own instruction to stay targeted):** `src/lib/largo/pre-earnings-
pack.ts`'s `preEarningsPackForLargo` calls `parseNextEarningsFromBenzinga(t, benzingaRes.rows,
today)` directly and merges the result with `loadNextEarningsFromBenzinga(t)` for its
`earnings_date`/`days_until`/`report_time`/`is_confirmed` fields, discarding `benzingaRes.error` for
those specific fields — even though the SAME card already has a working, correctly-named
`history_error` field for its separate print-history rows. A Benzinga outage on this card would
render `earnings_date: null` with no accompanying error for the next-earnings-date fields
specifically (print history's absence is still disclosed correctly via `history_error`). This is a
real, same-shape gap worth a dedicated follow-up fix, not touched here to keep this PR single-issue.

### Fix rationale

Mirrors the sibling "news" leg's already-shipped, already-correct pattern (`NewsResult.unavailable`
→ `assembleEcosystemArsenal`'s `reads.news.unavailable` branch) rather than inventing a new shape:
an optional `error` field on the result type, threaded through unchanged by every intermediate
layer, branched on at the one point that decides what to tell the member/Largo. The branch order in
`assembleEcosystemArsenal` matters: a real `earnings_date` still wins first (unchanged), then a
carried fetch error produces `retryable: true` with the real cause named in the reason string, and
only a `null` earnings read with no error at all — genuinely nothing on file, nothing failed — keeps
the original `retryable: false` "no upcoming date" behavior exactly as before. `NextEarnings.error`
is additive and optional so every other consumer of the type (four call sites, confirmed via grep
above) needs zero changes. Deliberately left `parseNextEarningsFromBenzinga`'s own signature
untouched to avoid widening this fix into the two other, already-differently-handled call sites
(`pre-earnings-pack.ts`, `run-tool.ts`) that read it directly.
