> **kind:** FINDING

## 2026-11-07 — `isDiscordEodRecapWindow`'s minute bound structurally excluded every real HELIX digest cron tick — the HELIX EOD recap could never fire — FIXED

| **Status** | FIXED on `fix/helix-eod-recap-never-fires` |
| --- | --- |

### Area

`src/lib/discord-eod-recap.ts` — `isDiscordEodRecapWindow`, the gate that decides whether a given
tick is inside the ~4 PM ET "session recap" window shared by the HELIX whale-flow and dark-pool
Discord digest crons (`src/app/api/cron/helix-discord-digest/route.ts`,
`src/app/api/cron/darkpool-discord/route.ts`).

### Root cause

`isDiscordEodRecapWindow` required `hour === 16 && minute >= 4 && minute <= 14`. The HELIX digest
cron (`railway.helix-discord-digest.toml` / `cron-registry.ts`: `schedule_cron_utc: "*/15 11-21 *
* 1-5"`) ticks at exact ET quarter-hours — `:00`/`:15`/`:30`/`:45` — because the America/New_York
<-> UTC offset is always a whole number of hours (-4 EDT / -5 EST), so the minute component never
shifts between zones. Neither of the cron's two ticks nearest the close falls inside `[4,14]`:

- **`:00`** (4:00 PM ET exactly) is still inside `isEtCashRth` — its close boundary is `mins <=
  close`, inclusive — so that tick is swallowed by the function's own `if (isEtCashRth(now))
  return false;` guard before the minute check is even relevant, and separately the route's own
  outer gate doesn't skip it (it's a normal in-RTH tick), so it never reaches the EOD branch
  either way.
- **`:15`** (4:15 PM ET) is one minute past the old upper bound of 14, so
  `isDiscordEodRecapWindow` returned `false` for it — and with that, the route's outer check
  (`!isEtCashRth(now) && !isDiscordEodRecapWindow(now)`) evaluated `true && true`, so the whole
  request short-circuited with `"Outside cash RTH"` before the `isDiscordEodRecapWindow(now)`
  check inside the try-block (the one that actually posts the recap) was ever reached.

With both of the HELIX cron's real tick times excluded, the HELIX EOD recap branch
(`buildHelixEodRecapEmbed`, fully built, unit-tested, and wired into the route) was **dead code in
production** — structurally unreachable by any real cron invocation, not merely gated off by
config. The dark-pool EOD recap was unaffected: its cron ticks every 2 minutes
(`*/2 11-21 * * 1-5`), landing at `:04/:06/:08/:10/:12/:14`, all already inside the old window —
which is exactly why the function's own header comment ("dark pool cron (2m) and HELIX digest
(15m) both land here") read as true in testing (the dark-pool side genuinely does land) while
being false for HELIX.

### Evidence

Direct calls against the real function, matching the deployed cron's exact tick instants:

```
isDiscordEodRecapWindow(new Date("2026-08-04T20:00:00.000Z")) // 4:00 PM ET, EDT -> false
isDiscordEodRecapWindow(new Date("2026-08-04T20:15:00.000Z")) // 4:15 PM ET, EDT -> false
isDiscordEodRecapWindow(new Date("2026-11-16T21:00:00.000Z")) // 4:00 PM ET, EST -> false
isDiscordEodRecapWindow(new Date("2026-11-16T21:15:00.000Z")) // 4:15 PM ET, EST -> false
```

Both of the HELIX cron's only two candidate ticks near the close returned `false` in both DST
regimes — there is no real cron invocation under the old code that could ever have set
`isDiscordEodRecapWindow(now) === true` for the HELIX route. `railway.helix-discord-digest.toml`'s
`cronSchedule = "*/15 11-21 * * 1-5"` and `cron-registry.ts`'s identical
`schedule_cron_utc: "*/15 11-21 * * 1-5"` confirm the deployed/registered schedule agrees (no
drift between the two sources for this cron).

RED->GREEN: added three regression tests to `discord-eod-recap.test.ts` asserting the function's
value at the HELIX cron's real `:00` and `:15` ticks (and one just past the new bound, `:16`).
Pre-fix (`git stash` on the lib-only change): the new `:15`-tick test fails —
`isDiscordEodRecapWindow` returns `false` where it must return `true` for the HELIX recap to ever
fire. Post-fix: all tests in the file pass (15/15), full repo suite 18130/18130 pass (`npm test`,
Node 20), `npx tsc --noEmit` clean.

### Fix

Widened the upper minute bound from `14` to `15`, so the HELIX cron's real `:15` tick now
satisfies the window. The `:00` tick correctly still never triggers the EOD branch — it's still
inside cash RTH, which is the right behavior (the recap should only fire once the session is
actually over). Added a block comment explaining the cron-vs-window arithmetic so a future reader
isn't tempted to "simplify" the bound back down. No alternative was considered worth taking: a
cron-schedule change (e.g. moving the HELIX digest to fire on `:05`-style offsets) would touch a
deployed EventBridge rule and the `.toml` catalog for a cosmetic reason, whereas widening this
one-line window by a single minute fixes the actual defect with no infra change and no behavior
change to the other 95 ticks/day this cron fires.

### Blast radius

`isDiscordEodRecapWindow` has exactly two call sites, both cron routes
(`helix-discord-digest/route.ts`, `darkpool-discord/route.ts`), both of which call it with the
real `now` at request time — neither route needed any change, since both already gate correctly
on the function's return value; only the function's own bound was wrong. The dark-pool route is
unaffected by this fix (its cron's ticks were already inside `[4,14]`, and remain inside the wider
`[4,15]`). No other consumer of `discord-eod-recap.ts` reads this function
(`grep -rn "isDiscordEodRecapWindow" src` — two call sites, both covered above).

### Evidence files

- `src/lib/discord-eod-recap.ts` — the fix + explanatory comment.
- `src/lib/discord-eod-recap.test.ts` — three new regression tests.
- `railway.helix-discord-digest.toml`, `src/lib/cron-registry.ts` — confirm the deployed/registered
  schedule (`*/15 11-21 * * 1-5`) that makes this a live, not theoretical, bug.

Found per round-384's assignment (`src/lib/ai-spend.ts` / `src/lib/discord-eod-recap.ts`, flagged
by round 382 for a focused bug-hunt on ET wall-clock parsing). `ai-spend.ts` and the rest of
`discord-eod-recap.ts` were read in full and found clean on this pass — this is the one real logic
defect found in the pair.
