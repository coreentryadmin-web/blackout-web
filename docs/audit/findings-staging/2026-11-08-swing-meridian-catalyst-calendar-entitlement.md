> **kind:** FINDING

## Swing play-brief's "Meridian catalysts" section claimed "calendar is quiet, not missing" even when the Benzinga calendar fetch itself was refused — FIXED

| | |
|---|---|
| **Area** | `src/lib/swing/play-brief-meridian.ts` (`fetchMeridianForTicker`) + `src/lib/swing/play-brief-intel.ts` (`meridianCatalystSection`) — the swing play-brief's "Meridian catalysts" section; also fixed the identical success-path gap on `src/lib/largo/meridian-for-largo.ts` (`meridianTimelineForLargo`) |
| **Status** | FIXED |
| **File** | `src/lib/swing/play-brief-meridian.ts`, `src/lib/swing/play-brief-intel.ts`, `src/lib/largo/meridian-for-largo.ts`, `src/lib/largo-terminal.ts` |

### Root cause

Same "absence mislabeled as fabricated certainty" bug class fixed earlier the same day in PR #7586
(`src/lib/largo/pre-earnings-pack.ts`'s `earnings_error` field) — but that fix touched only one of
several independent code paths that all serve Largo's "Meridian catalysts" read. This is a
DIFFERENT, sibling code path, never touched by #7586.

`loadMeridianTimelineResponse` (`src/lib/meridian/meridian-snapshot.ts:90`) already computes
`earnings_calendar_entitled: earningsBundle.calendar_entitled` correctly off the real Benzinga
`/benzinga/v1/earnings` fetch — threaded cleanly from `fetchBenzingaStructuredEarnings`'s own
`entitled`/`error` result through `loadBenzingaEarningsBundle` (`entitled: windowRes.entitled`) and
`loadMeridianEarningsTimeline` (`calendar_entitled: bundle.entitled && boardRes.entitled`,
`meridian-timeline-server.ts:227`). This signal was never broken; it was simply dropped one layer up:

- `fetchMeridianForTicker` (`play-brief-meridian.ts`) calls into this machinery but its returned
  `SwingMeridianCatalystSlice` type only carried `{as_of, items, total_matched, window_truncated}`
  — it never read or forwarded `payload.earnings_calendar_entitled`.
- `meridianCatalystSection` (`play-brief-intel.ts`) checks only `slice.unavailable` (set on a
  thrown exception) and `slice.window_truncated` (a pagination-cap defect, fixed 2026-11-01 for a
  prior, unrelated case) before falling to the literal hardcoded string "No catalysts in the
  **14-day** Meridian window on this read — calendar is quiet, not missing." for ANY empty `items`
  array — including one that is empty because the fetch itself was refused or errored.

A second, independent occurrence of the identical gap: `meridianTimelineForLargo`
(`src/lib/largo/meridian-for-largo.ts`) — the general-purpose Largo social/catalyst prefetch used by
`largo-terminal.ts`, `mini-panel.ts`, and `desk-scope-prefetch.ts` — also reads
`loadMeridianTimelineResponse` but reports `available: true` unconditionally on its success path,
regardless of `earnings_calendar_entitled`, so a refused/errored calendar fetch silently dropped
earnings rows from `upcoming_7d` while reporting itself as a fully working read.

### Evidence

**Live production evidence (from the originating investigation, re-confirmed against current
source rather than trusted at face value):** `GET /api/market/swing/play-brief` on MRNA/META/PANW/
GOOG/CG positions shows the "Meridian catalysts" section's body containing "calendar is quiet, not
missing" while the SAME response's `envelope.unavailableSources` (a completely different,
already-correct code path — the BIE arsenal's `earnings` leg) simultaneously discloses
`{"source": "earnings", "reason": "next earnings date unavailable:
benzinga_ticker_earnings:not_entitled", ...}` for the identical ticker in the identical brief. Two
sections of one response disagreeing about whether the calendar check even ran — consistent with
CLAUDE.md's "ENTITLEMENT REGRESSED 2026-11-07" note (the Benzinga add-on 403ing platform-wide).

**Source trace confirmed against current `main` before fixing** (grep):
```
src/lib/meridian/meridian-snapshot.ts:90:    earnings_calendar_entitled: earningsBundle.calendar_entitled,
src/lib/meridian/meridian-timeline-server.ts:96:  calendar_entitled: boolean;
src/lib/meridian/meridian-timeline-server.ts:227:    calendar_entitled: bundle.entitled && boardRes.entitled,
```
— the signal exists and is correct at the payload layer; `fetchMeridianForTicker`'s return
statement (pre-fix) and `meridianTimelineForLargo`'s success-path return (pre-fix) both omitted it.

**RED → GREEN proof** (worktree-local backup copies of the four touched files, restored after the
RED run — no shared git stash used, per this sandbox's shared-stash-stack caution):

- `src/lib/swing/play-brief-intel.test.ts` — reverted `play-brief-meridian.ts` + `play-brief-intel.ts`
  to `origin/main`, kept the new tests: **2/4 new tests fail** (`calendar_entitled false` cases;
  the two `undefined`/`true` no-regression cases correctly still pass either way):
  ```
  not ok - meridianCatalystSection: refused/errored calendar fetch discloses 'cannot confirm' ...
    actual: 'No catalysts in the **14-day** Meridian window on this read — calendar is quiet, not missing.'
  not ok - meridianCatalystSection: calendar_entitled false takes precedence over window_truncated ...
    actual: "Meridian's market-wide earnings calendar fetch was truncated this read ..."
  ```
  Post-fix (restored): **360/360 pass** (full `play-brief-intel.test.ts` suite, including the 4 new
  tests).
- `src/lib/largo/meridian-for-largo.test.ts` (new file) — reverted `meridian-for-largo.ts` to
  `origin/main`: **0/3 pass** (every test fails — pre-fix, `result.calendar_entitled` is `undefined`
  on every branch, including the "no regression" cases, since the field didn't exist at all).
  Post-fix (restored): **3/3 pass**.

Full regression sweep (Node 20, `--experimental-test-module-mocks`):
- `src/lib/swing/play-brief-meridian.test.ts` + `play-brief-intel.test.ts` +
  `src/lib/largo/meridian-for-largo.test.ts` + `src/lib/largo-terminal.test.ts` +
  `src/lib/meridian/meridian-benzinga-earnings.test.ts`: **392/392 pass** combined.
- Whole-directory sweep, `src/lib/swing` + `src/lib/largo` + `src/lib/meridian` (every `*.test.ts`
  in all three, 283 files): **4246/4246 pass, 0 fail** — no regression anywhere in the affected
  surface.
- `npx tsc --noEmit`: clean. Both new fields (`calendar_entitled` on `SwingMeridianCatalystSlice`
  and on `meridianTimelineForLargo`'s return) are additive/optional; the catch-branch return of
  `meridianTimelineForLargo` was given an explicit `calendar_entitled: null` specifically so its
  shape stays structurally consistent with the success branch for callers that narrow on
  `meridian?.available` (TS otherwise widens the literal `true`/`false` to a bare `boolean` across
  the two branches of the inferred union, which blocked property access on the field added only to
  one branch — confirmed by the compiler error this produced before that adjustment).

### Blast radius

- `meridianCatalystSection` (play-brief-intel.ts) — the direct fix target: swing play-brief
  "Meridian catalysts" section, read by every member brief and by Largo tool-use.
- `meridianTimelineForLargo` (meridian-for-largo.ts) — fixed as the task's named optional second
  occurrence, since it was cheap and clearly the same bug shape. Three call sites consume it, all
  additively unaffected (none destructure `calendar_entitled` today, so none needed a code change):
  `largo-terminal.ts` (chat tool-use prefetch — given one added prompt-text caveat sentence,
  mirroring #7586's pattern on the sibling `history_error` caveat, so the model is told what a
  `false` value means rather than left to infer it from a raw JSON dump), `mini-panel.ts` and
  `desk-scope-prefetch.ts` (both dump/derive from the same object; untouched, receive the new field
  for free).
- **Deliberately NOT fixed in this PR** (disclosed, per this fix's scope discipline):
  - `meridianPeerSection`'s ("Earnings peer lens") own `window_truncated` check
    (`play-brief-intel.ts` ~line 2921) has the identical missing `calendar_entitled` branch — same
    bug class, but a different section title ("Earnings peer lens", not "Meridian catalysts") the
    task scoped this fix away from widening into. A genuinely quiet reading of this section during
    a Benzinga outage would currently render silence (no section) rather than a disclosure, exactly
    as it did for `window_truncated` before that section's own 2026-11-01 fix.
  - `shapeMeridianNighthawkBoardRead` (`meridian-cross-product-for-earnings-core.ts`) /
    `readMeridianBoardSnapshot` (`meridian-board-tickers.ts`): checks only `board.available`/
    `snap.available`, whose TYPE is the literal constant `true` on every payload including the
    degraded fallback (`zerodte-service.ts` ~line 280) — a structural no-op against a real degraded
    board. This needs a materially different shape of fix (the check itself is unreachable, not
    merely missing a signal to check), so it is named here as a follow-up rather than bundled in.

### Fix rationale

Mirrors the already-established, already-shipped pattern on this exact file for the sibling
`window_truncated` signal (PR for the 2026-11-01 QXO fix) rather than inventing a new shape:

1. `SwingMeridianCatalystSlice.calendar_entitled?: boolean` — forwarded unconditionally from
   `payload.earnings_calendar_entitled` in `fetchMeridianForTicker`'s success-path return.
   `undefined` only ever occurs via `meridianUnavailableSlice()`'s own `unavailable: true` sentinel,
   which `meridianCatalystSection` already short-circuits on before reaching this field — so the
   `=== false` check (not a loose falsy check) correctly treats every pre-existing test fixture in
   this file (which all omit the field) identically to a genuinely entitled read, with zero risk of
   a false positive on an absent value.
2. `meridianCatalystSection`'s zero-items branch now checks `calendar_entitled === false` AHEAD of
   `window_truncated` — a refused/errored fetch is the more fundamental failure (the pagination
   loop that produces `window_truncated` never even starts on a 403/error), and in real production
   data the two are mutually exclusive (`fetchBenzingaStructuredEarnings` returns
   `rows: [], truncated: false` on a refusal, never reaching its own page cap) — but the ordering is
   still pinned by a dedicated test in case that invariant ever changes.
3. `meridianTimelineForLargo`'s success-path return gained the same forwarded field, with one
   explanatory prompt-text sentence added in `largo-terminal.ts` next to its existing `history_error`-
   style caveat precedent, rather than leaving the model to infer the meaning of a bare boolean from
   a raw JSON dump.

Deliberately left `meridianPeerSection` and the cross-product board-read gap as disclosed follow-ups
rather than widening this PR — both are named above with enough detail for a future pass to pick up
without re-discovering them from scratch.
