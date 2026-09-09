# Swing play-brief unavailableSources mislabels Night Hawk Legacy as "Night Hawk swings" — FIXED

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **ID** | BO-P2-swing-brief-nighthawk-legacy-mislabel |
| **Pri** | P2 |
| **Area** | Night Hawk Swings / Ask Largo (standing ownership mandate deep-dive) |
| **Status** | FIXED |

## Symptom

`collectBriefUnavailableSources()` (`src/lib/swing/play-brief-absence.ts`) emits a
`{ source: "Night Hawk swings", reason: "prior session (…) — today's edition not yet run" }`
row whenever `ctx.ecosystem.nighthawk_recent.edition_for` lags the brief's own `sessionDate`.

Live repro, `GET /api/market/swing/play-brief?playId=SWING:CRWD:19` (2026-09-09, Ask Largo
standing deep-dive): the envelope's `unavailableSources` carried
`{"source":"Night Hawk swings","reason":"prior session (2026-08-28) — today's edition not yet
run"}` — a chip reading "our own Swing board is 12 sessions stale", surfaced *inside a Night
Hawk Swings play-brief*, while the live Swing board itself (checked the same run via
`GET /api/market/nighthawk/horizons?view=swings`) was fully current (`scanAsOf` the same
session). This is a false alarm about the wrong product, both to a member reading the
`UnavailableChip` and to Largo itself, which receives this string verbatim as a tool result and
would reason about it as if the Swing product's own data were stale.

## Root cause

`ctx.ecosystem.nighthawk_recent` is populated in `src/lib/bie/ecosystem-context.ts` from
`nighthawk_play_outcomes` (`src/lib/db.ts`) — confirmed by that table's own schema/columns:
`edition_for` (an evening-publish artifact), `next_day_open`/`next_day_close`,
`publish_context`, and a column literally named `discord_live_state` documented in-file as
"Legacy Chief Trade Alert Bot live state". This is Night Hawk **Legacy**'s next-day-digest
table — per `CLAUDE.md`'s own product breakdown, "Legacy = separate post-close next-day digest"
— and has nothing to do with the live, continuously-scanning Swing board this brief is for.
That board's own staleness is *already* reported correctly, a few lines above in the same
function, as `"swing discovery scan"` (keyed off `ctx.scanSessionDay`) — a second, genuinely
distinct absence check existed and was correctly named; only this one, for a different upstream
product, was not.

The original fix that introduced this row (staged 2026-09-07,
`BO-P2-largo-nighthawk-unavailable-c3`, since folded into `FINDINGS.md`) named it "Night Hawk
swings" — plausibly reading "edition_for" as "Night Hawk's last swing/take on this name" (a verb
usage the intel section itself also uses, in `play-brief-intel.ts`'s
`` `Night Hawk's last swing on this name (**${nh.edition_for}**) ...` `` prose, which is fine
there because "swing" is a common noun in that sentence, not the product name). As a
`unavailableSources[].source` VALUE — read standalone, by a member's UI chip or by Largo's model
— "Night Hawk swings" unavoidably reads as the product name "Night Hawk Swings", i.e. exactly
the board this brief serves. This is the C4 IDENTITY violation
`docs/audit/LARGO-PRODUCT-CONTRACT.md` calls out by name (its own SPX-vs-SPY example): a
plausible wrong identity is worse than an obviously-missing one, because nothing downstream can
tell it apart from the truth.

## Blast radius

Only this one `source` string (`play-brief-absence.ts`, one `out.push()` call). No other file in
`src/` referenced the literal `"Night Hawk swings"` string (checked via repo-wide grep) — the
narrative/coaching call sites (`play-brief-narrative.ts`, `play-brief-narrative-coaching.ts`) use
`"Night Hawk bearish"/"Night Hawk bullish"` prose, which does not carry the same ambiguity and
was left untouched. Affects every Swing play-brief where the referenced ticker's most recent
Legacy edition predates the brief's own session — i.e. any evening/pre-Legacy-publish window,
which is most of the trading day before Legacy's post-close edition ships.

## Fix

Renamed the source label to `"Night Hawk Legacy"`, matching the product name `CLAUDE.md` and the
rest of the codebase already use for this table, and added an in-code comment at the call site
documenting the DB/table provenance so a future reader does not have to re-derive it. No behavior
change beyond the string — the staleness check itself (`nh.edition_for !== ctx.sessionDate`,
suppressed once `isClosed`) is correct and untouched.

## Evidence

- Live envelope capture above (2026-09-09, temp Clerk admin session via
  `scripts/audit/lib/prod-clerk-session.mjs`), cross-checked against the same-session
  `GET /api/market/nighthawk/horizons?view=swings` board to confirm the Swing board itself was
  NOT stale.
- `src/lib/db.ts` `nighthawk_play_outcomes` CREATE TABLE + column comments (`edition_for`,
  `next_day_open`/`next_day_close`, `discord_live_state` — "Legacy Chief Trade Alert Bot live
  state") confirm the table's product ownership.
- RED→GREEN on Node 20 (`/opt/node20/bin`): reverted only the `.ts` source fix while keeping the
  updated test expectation — `npx tsx --test src/lib/swing/play-brief-absence.test.ts` → 41
  pass / **1 fail**; re-applied the fix → **42 pass / 0 fail**.
- Full `src/lib/swing/*.test.ts` sweep: 815/817 pass; the 2 failures
  (`ex-dividend-reads.test.ts`, `play-brief-resolve.test.ts`) are pre-existing and unrelated —
  confirmed by re-running them in isolation with this branch's changes stashed (`mock.module is
  not a function`, a test-harness/tsx interaction, not a regression from this change).
- `npx tsc --noEmit`: clean.
