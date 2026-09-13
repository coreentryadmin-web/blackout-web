## 2026-09-13 — [FINDING, P4 SEO/stale-config] `robots.ts` disallows `/grid`, a route removed months ago — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED — merged same PR. |
| **Severity** | P4 — zero live impact. A `Disallow` rule for a path that already 404s does nothing harmful (a crawler that hits it gets a 404 either way; robots.txt only controls whether a crawler *bothers* requesting a URL at all, and nothing links to `/grid` anymore for a crawler to discover). Purely stale config. |

### What was found

DISCOVERY-lane live-UI sweep this cycle screenshotted `/grid` (listed in `robots.ts`'s `DISALLOWED_ROOTS`, which is otherwise a reliable inventory of real auth-gated app surfaces) expecting a real desk page — it rendered the site's unstyled default 404 instead (`This page doesn't exist.`). `find src/app -iname "*grid*"` confirms no `src/app/grid/` route exists. `git log --diff-filter=D -- 'src/app/grid*'` traces it to commit `40099f00a` / `6e0278fe0`, **"feat: remove classic Grid page and infrastructure (#648)"** — that PR removed the Grid page and its route but never removed the corresponding entry from `robots.ts`'s disallow list.

### Fix

Removed `"/grid"` from `DISALLOWED_ROOTS` in `src/app/robots.ts`. Updated the existing `robots.test.ts` bare-route/sub-path parametrized test (which explicitly asserted `/grid` was disallowed) to drop it from its fixture list, and added a new regression test asserting `/grid` and `/grid/` are NOT in the wildcard rule's disallow list, citing the removal PR by number so a future re-add of the entry (e.g. a careless copy-paste) fails loudly instead of silently.

### Evidence

RED→GREEN via controlled file-swap (not `git stash` — this is a shared checkout other sessions may be actively using): checked out the pre-fix `robots.ts` from `HEAD`, ran `robots.test.ts` — 6/7 pass, 1 fail (the new test, as expected). Restored the fixed file, re-ran — 7/7 pass. `npx tsc --noEmit -p .` clean.

### Blast radius

Single file (`robots.ts`) plus its test file. No other code references `/grid` as a route (`src/lib/client-error-report.test.ts` uses `"/grid"` only as an arbitrary example scope string in an unrelated fixture, not as a route assertion — left untouched, correctly out of scope).

### Why fixed directly, not written up

Single-line config removal + a two-line test update, in a file (`robots.ts`) untouched by any of the 9 owning lanes' recent activity, with a pre-existing test suite that made the RED→GREEN proof mechanical rather than exploratory. Exactly the shape the standing issue-handling policy calls "fix directly," not "write up."
