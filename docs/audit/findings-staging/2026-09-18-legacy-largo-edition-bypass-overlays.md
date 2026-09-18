> **kind:** `FINDING`

## Ask Largo's Legacy `get_nighthawk_edition` tool bypassed the member route's resolution ladder and read-time overlays entirely — FIXED

| Field | Value |
|---|---|
| **Status** | FIXED |
| **Area** | Night Hawk Legacy / Ask Largo (`src/lib/largo/run-tool.ts`, `get_nighthawk_edition`) — found via the Ask Largo standing mandate's desk-rotation deep-dive (Legacy, after Swing/0DTE/Vector were audited clean) |
| **Severity** | P1 (Largo could describe an already-pulled/invalidated play as an ordinary live pick, and never disclosed carried-forward/stale/degraded/no-plays states — the exact absence-disclosure violation `docs/audit/LARGO-PRODUCT-CONTRACT.md` exists to prevent, on a member-facing AI answer) |
| **PR** | fix/legacy-largo-edition-bypass-overlays |

### Root cause

`run-tool.ts`'s `get_nighthawk_edition` case called the bare platform getters
(`marketPlatform.nighthawk.getLatestNightHawkEdition()` /
`getNightHawkEditionForDate()`) directly — a raw DB row through
`rowToNightHawkEdition`, with **none** of the member route's
(`src/app/api/market/nighthawk/edition/route.ts`) resolution ladder or
read-time overlays applied. Two silent consequences:

1. **Invalidated/tiered plays looked like ordinary live picks.** `pulled`/
   `pulled_reason` (a morning-confirm INVALIDATED verdict, merged from
   `pull-overlay.ts`) and `tier`/`morning_checked_at` (pinned tier assignment,
   merged from `publish_context`) are read-time overlays per `PlaybookPlay`'s
   own field comments (`src/features/nighthawk/lib/types.ts:56-72`) — the raw
   published `plays` JSONB row never carries them.
2. **Freshness/absence state was never computed on this path at all**:
   `degraded` (legacy-engine fallback), `stale`+`served_for` (bounded-age
   "latest" fallback), `carry_until_close` (a still-open prior session's
   plays served because tonight's hasn't published), `no_plays` (a real
   publish with zero surviving plays) — all live only inside the route's own
   `resolveNighthawkEdition`, which the tool case never called. Even had it
   been computed, `compactNightHawkEditionForModel`'s `EditionLike` type
   didn't include these fields — they'd have been silently dropped.

Cross-checked against the sibling Largo composers already audited this
session (0DTE, Vector) — this exact "bypass the route's own
resolution/overlay logic" shape is specific to Legacy; 0DTE/Vector have no
equivalent fallback ladder to bypass.

### Evidence

- `run-tool.ts` (pre-fix): confirmed the bare `marketPlatform.nighthawk.get*`
  calls with zero resolution/overlay logic, via `git diff` against the fix.
- `route.ts` (pre-fix, verified via `git show HEAD:...`): confirmed the full
  fallback ladder (`carry_until_close`, `degraded`, `stale`/`served_for`,
  `no_plays`) defined inline in `resolveNighthawkEdition`, not exported
  anywhere for reuse.
- `types.ts:56-72`: confirmed `pulled?`/`pulled_reason?`/`tier?`/
  `morning_checked_at?` are all documented read-time-overlay fields ("merged
  at read time by pull-overlay.ts" / "merged at read time from
  publish_context" / "read-time overlay") — grep-verified independently,
  exact line numbers match.

RED→GREEN proof (independently reproduced on the current working tree, off
latest `origin/main`):
- Reverted `nighthawk-edition-for-model.ts` via `git stash push -- <file>`,
  keeping the 5 new tests and the rest of the fix (`run-tool.ts`,
  `resolve-edition.ts`, `route.ts`). `npx tsx --experimental-test-module-mocks
  --test src/lib/largo/nighthawk-edition-for-model.test.ts`: **5/15 fail**
  (exactly the 5 new freshness/absence-forwarding tests), 10 pre-existing
  pass.
- Restored (`git stash pop`). Re-ran the same file: **15/15 pass**.
- Broader sweep (`src/features/nighthawk` + `src/lib/largo` +
  `src/app/api/market/nighthawk`, all `*.test.ts`): **3095/3095 pass**
  (includes 2 pre-existing contract tests updated to follow the refactor —
  `nighthawk-pinning-contract.test.ts`, `route.test.ts` — same properties
  asserted, now pointed at the shared module).
- `npx tsc --noEmit -p .` on Node 20: clean, 0 errors.

### Blast radius

- `src/app/api/market/nighthawk/edition/route.ts`: the DB-only core of
  `resolveNighthawkEdition` and its helpers (`markNoPlays`/`emptyEdition`/
  `withEditionOverlays`/`withPullOverlay`/`withOutcomeOverlay`) extracted,
  unchanged logic, to a new shared module — the route's own behavior is
  unchanged (~190 duplicated lines removed, `timeoutFallbackEdition`/
  `lastGoodEdition`, which are process-cache-specific, stayed local).
- `src/lib/largo/nighthawk-edition-for-model.ts`: `EditionLike` extended with
  `degraded`/`stale`/`served_for`/`carry_until_close`/`no_plays`;
  `compactNightHawkEditionForModel` now forwards all five plus a synthesized
  `freshness_note` string so the model can pass the caveat to a member.
- Two pre-existing tests updated to follow the refactor to its new location,
  with the pinning-contract test strengthened to assert the tool case can
  never again silently regress to the bare platform getters.

### Fix rationale

Extract the DB-only core of the route's existing, already-correct
`resolveNighthawkEdition` into a shared module (`resolve-edition.ts`) so both
the member route and the Largo tool call the exact same resolution logic —
same fallback ladder, same overlays, same `editionFor` default
(`nextTradingDayEt(todayEt())`, matching what a member sees with no
`?date=`). This is the minimal fix that makes the two paths structurally
unable to diverge again, rather than duplicating the ladder a second time
inside `run-tool.ts` (which would just recreate the exact "two independent
implementations" root cause this fix removes).

### Verification

Independently re-verified from scratch on the current working tree (off
latest `origin/main`, post #5196/#5195/#5198/#5199/#5201) — not the
originating research agent's own claims taken at face value. Every claimed
pre-existing symbol/comment (the bare platform getters, `resolveNighthawkEdition`'s
fallback ladder, the four read-time-overlay field comments in `types.ts`) was
independently grep-verified at its exact location; RED/GREEN independently
reproduced via `git stash`; broader `*.test.ts` sweep (3095/3095) and
`tsc --noEmit` (clean) both independently re-run, not reused from the
subagent's report.
