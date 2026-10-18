> **kind:** FINDING

## Night Hawk edition cron's status response (and its own architecture doc) claimed the evening build runs via a nonexistent `npm run nighthawk:run` script — FIXED

| **Status** | Fixed (`src/app/api/cron/nighthawk-edition/route.ts`; `docs/audit/NIGHTHAWK-OVERNIGHT-DECISION.md`) |
|---|---|

**Found via:** this session's standing DISCOVERY-lane dead-code/stale-docs sweep — cross-checked every
`npm run <script>` reference in `docs/audit/*.md` and `scripts/audit/*.mjs` against the real script
list in `package.json`.

**Root cause.** `src/app/api/cron/nighthawk-edition/route.ts`'s `GET` handler (status/nudge path)
returns a `note` field in its JSON response: *"Long runs execute via `npm run nighthawk:run` (ECS
cron worker). This route nudges/resumes within 300s."* No such npm script has ever existed in
`package.json` (`grep -n '"nighthawk:run"' package.json` → no match; confirmed against the full 191-
script list). The real mechanism, per the route's own comment three lines above the string
(`route.ts:122-126`) and `edition-builder.ts`, is an in-process `next/server after()` callback —
`buildEveningEdition()` is dispatched from inside the same Next.js process after the HTTP response
flushes, on the long-lived ECS worker; nothing shells out to a separate script. The architecture doc
`docs/audit/NIGHTHAWK-OVERNIGHT-DECISION.md:83` independently asserted the same fabricated command
when describing this same code path — most likely copied from the live API response text rather than
the other way around, but either direction means a future reader (or a future session reaching for
`npm run nighthawk:run` to manually kick a stuck build) would hit a `missing script` error.

**Blast radius.** Two sites, same root claim: the live production API response string
(`route.ts:98`, reachable by any admin/ops reader of `GET /api/cron/nighthawk-edition`) and the
architecture doc. No other file references this script name (`grep -rn "nighthawk:run" --include=*.ts
--include=*.md .` returns only these two before the fix).

**Fix.** Corrected both to describe the real mechanism (in-process `after()` dispatch on the ECS
worker, no separate `npm run` script) instead of a command that doesn't exist.

**Tests.** Added a regression test to `src/app/api/cron/nighthawk-edition/route.test.ts` asserting
the route source never re-introduces the literal string `npm run nighthawk:run`. RED→GREEN proven via
`git stash` of `route.ts` alone (1/2 failing without the fix, 2/2 passing with it restored).
`tsc --noEmit`: clean.
