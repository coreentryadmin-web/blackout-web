> **kind:** FINDING

## HELIX / Dark Pool Discord EOD recap headline "total" was silently capped at the sample-query LIMIT — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P3 (community-facing Discord recap; no trading/member-platform impact) |
| **Area** | `src/lib/discord-eod-recap.ts`, `src/app/api/cron/helix-discord-digest/route.ts`, `src/app/api/cron/darkpool-discord/route.ts` |
| **Found by** | Round 415 discovery sweep, continuing the "total capped at sample-query LIMIT" bug class from PR #7574 (`error-sink.ts`) / PR #7575 (`admin-gex-health.ts`) |

### Root cause

`buildHelixEodRecapEmbed` and `buildDarkpoolEodRecapEmbed` (`discord-eod-recap.ts`) render the
~4:04-4:15 PM ET end-of-day Discord recap for the HELIX and Dark Pool community channels. Both
compute their headline "**N** qualifying prints/blocks · **$X** total premium/notional" line as
`session.length` / `session.reduce((s, f) => s + f.premium, 0)`, where `session` is whatever array
the caller passed in as `flows`/`prints`.

Both callers pass in an array that is itself a **row-count-capped fetch sized for a 15-minute live
digest window, reused for the WHOLE ~6-7 hour RTH session**:

- `helix-discord-digest/route.ts`'s EOD branch calls `fetchRecentFlows({ limit: 400,
  min_premium: 500_000, max_dte: 30, since_hours: sessionSinceHours, order: "recent" })` — a cap
  that was reasonable for the 15/30-min live digest's narrow window (reused from the same call
  shape), but `since_hours` here spans the **entire session** (~6.5-7h by the time the EOD window
  opens). `order: "recent"` means once the 400-row cap is hit, the DB returns the 400 *newest*
  matching rows and silently **drops every older qualifying print from earlier in the session** —
  at the exact moment (a high-flow session) the recap's "N qualifying prints"/"total premium"
  headline is most load-bearing and most wrong.
- `darkpool-discord/route.ts`'s EOD branch calls `fetchUwDarkPoolRecent(200)` — but that function
  internally clamps its own `limit` param to `Math.min(limit, 100)` (`unusual-whales.ts`), so the
  requested `200` never actually raises the real cap; the effective ceiling is 100 blocks for the
  whole session, same shape, same consequence.

This is the exact "total capped at sample-query LIMIT" pattern this session's audit has now found
and fixed three times: `error-sink.ts`'s `countAuthFailures` (PR #7574, `LIMIT 200` → `rows.length`
as `total_24h`) and `admin-gex-health.ts`'s `summarizeRegimeEvents` (PR #7575) both derived a
monitoring "total" from a bounded sample array instead of a genuine unbounded total — silently
plateauing under real load, understating severity exactly when it matters most. Here the
"dashboard" is a Discord recap embed instead of an admin panel, but the shape is identical: a
headline total presented as exact when it is actually a lower bound.

**Why this wasn't caught earlier:** this exact file already has two documented regression fixes
for *adjacent* bugs in the same EOD-recap code path — the window being structurally unreachable
(dead code, `isDiscordEodRecapWindow`'s old `minute <= 14` bound) and the fetch window being too
short (`since_hours: 6` vs the real ~6.5-7h elapsed by the time the EOD tick fires, fixed by
`hoursSinceSessionOpenEt`). Both of those fixes corrected *which* rows are fetched; neither
addressed *how many* rows the fetch can return before silently truncating — a different axis of
the same underlying design (a fixed, small-session-sized cap reused for a full-session read).

### Evidence (RED → GREEN)

Added two regression tests to `src/lib/discord-eod-recap.test.ts` asserting the new `truncated`
flag renders an honest "+" suffix instead of a false-precise number:

```
test("buildHelixEodRecapEmbed marks the headline count/premium as a lower bound when the
      caller's fetch was truncated", ...)
test("buildDarkpoolEodRecapEmbed marks the headline count/notional as a lower bound when
      truncated", ...)
```

**RED** (stashing only the three source-file changes, keeping the new tests): both new tests
failed against the pre-fix code —
`buildDarkpoolEodRecapEmbed({ ..., truncated: true })` rendered `**2** blocks · **$13.0M**
notional` (no "+"; `truncated` wasn't even a recognized field) instead of the expected
`**2+** blocks · **$13.0M+** notional`:

```
not ok - buildDarkpoolEodRecapEmbed marks the headline count/notional as a lower bound when truncated
  The input did not match the regular expression /\*\*2\+\*\* blocks/. Input:
  '**2** blocks · **$13.0M** notional · 1 buy / 1 sell\n...'
```
(same failure shape for the HELIX test.)

**GREEN** (fix restored): full `discord-eod-recap.test.ts` — 17/17 pass, including both new tests
and every pre-existing test (the no-`truncated`/default-false case stays byte-identical to before,
confirmed by an explicit `doesNotMatch(/\*\*2\*\* qualifying prints/)` pairing with the truncated
case). `src/app/api/cron/helix-discord-digest/route.test.ts` and
`src/app/api/cron/darkpool-discord/route.test.ts` also pass unchanged (9/9) — neither mocks the
exact `buildHelixEodRecapEmbed`/`buildDarkpoolEodRecapEmbed` call shape, so adding the optional
`truncated` field is non-breaking there. `npx tsc --noEmit` clean.

### Fix rationale

Reproducing an **exact** qualifying total for the HELIX side would require re-deriving
`fill_price` (one of three `passesHelixDiscordFilters` gates, applied in-process after the fetch)
in raw SQL — a non-trivial, several-branch JSON-payload cast that `fetchRecentFlows`'s own row
query already needs (see `db.ts`, the `raw_payload->>'price'` CASE chain). Duplicating that
derivation into a second, unbounded aggregate query would itself be the kind of duplicated-logic
risk this repo's own audit history keeps flagging (two independent implementations of the same
rule drifting apart over time) — and the dark-pool side has no DB-backed total to query at all
(it reads through a UW-provider cache with its own internal cap, not a query this app controls).

Instead, both `build*EodRecapEmbed` functions take a new optional `truncated?: boolean`. Each
caller sets it to `true` exactly when its own fetch returned **the full amount of its known cap**
(`sessionRows.length >= 400` for HELIX, `rawRows.length >= 100` for Dark Pool) — a cheap, reliable
signal: that condition can only occur when the underlying source genuinely had at least that many
matching rows, so it never produces a false positive. When set, the embed renders the headline
count and total with an honest "+" suffix (`**412+** qualifying prints · **$8.30M+** total
premium`) instead of silently presenting a definitely-incomplete sample as if it were exact.
Default (`truncated` omitted/false) is byte-identical to the pre-fix behavior, so the common,
non-truncated case — which is most sessions — is unaffected.

**What was deliberately left unchanged:** the 400-row / 100-row caps themselves. Raising them
further only pushes the same silent-undercount failure mode to a higher, still-finite threshold;
an honest "lower bound" indicator is the correct fix regardless of where the cap sits, and it costs
nothing extra per request (no new query). The 15/30-minute live-digest call sites are untouched —
their own `inWindowCount` tracking already measures the narrow window correctly within the existing
cap's ample margin; only the two **EOD, full-session** call sites needed the flag.

### Blast radius

- `src/lib/discord-eod-recap.ts` — both `buildHelixEodRecapEmbed` and `buildDarkpoolEodRecapEmbed`
  (same file, same root-cause shape — fixed together rather than just the one first noticed, per
  this repo's duplicated-logic blast-radius policy).
- `src/app/api/cron/helix-discord-digest/route.ts` — wires `truncated` from the session-wide
  `fetchRecentFlows` call.
- `src/app/api/cron/darkpool-discord/route.ts` — wires `truncated` from `fetchUwDarkPoolRecent`,
  and documents in-line that its requested `limit: 200` is dead — the provider function clamps to
  100 regardless (a separate, much smaller, pre-existing cosmetic discrepancy noted but not changed
  here, since changing the requested number doesn't change behavior either way).
- No other caller of either `build*EodRecapEmbed` function exists (both are EOD-recap-specific,
  grepped repo-wide).

### Market-open validation

Logged to `docs/audit/MARKET-OPEN-VALIDATION.md`: on the next live RTH session with meaningful
HELIX/dark-pool flow volume, check the ~4:04-4:15 PM ET `#helix`/`#darkpool` Discord EOD recap
posts — on a normal/quiet day the headline should read exactly as before (no "+"); it should only
show a "+" suffix on a genuinely high-flow session where the underlying fetch actually hit its cap
(verifiable against `GET /api/market/zerodte/record`-style live counts is not applicable here —
instead cross-check cron run logs for `posted_eod: true` and, if available, a same-day HELIX desk
screen with min-premium/DTE filters matching `HELIX_DISCORD_MIN_PREMIUM`/`HELIX_DISCORD_MAX_DTE`
to sanity-check whether the true session count plausibly exceeded 400/100).
