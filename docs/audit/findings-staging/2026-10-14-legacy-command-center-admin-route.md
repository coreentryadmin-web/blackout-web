> **kind:** FINDING

## Night Hawk Legacy — morning command-center admin route (Phase 2F part 2, route wiring) — SHIPPED

| **Status** | SHIPPED (admin route wiring `buildCommandCenterTable` to live data; follow-on to #6005) |

### Root cause / gap

PR #6005 shipped `buildCommandCenterTable`, the pure safe-half composer for operator priority
#14's morning command-center table, deliberately WITHOUT a route — same two-step pattern every
prior Phase 2 sub-step used (pure primitive first, route wiring as a separate PR). This PR is
that follow-on.

### Evidence / what shipped

`src/app/api/admin/nighthawk/command-center/route.ts` — admin-gated (`requireAdminApi`), read-only
GET, same structural pattern as the existing `candidate-leaderboard`/`direction-failure-diagnosis`
admin routes (fetch → pure compute → `roundFloats` → JSON). Wires the composer's four inputs to
real data:

- **ACTIVE** — `resolveNighthawkEdition(...).plays`, the SAME member-facing, overlay-applied
  (pulled/morning-confirm) plays the public `/api/market/nighthawk/edition` route serves. Not a
  raw pre-overlay DB row — admin tooling should see what members see, not a stale approximation.
- **WATCHING/REJECTED** — `buildCandidateLeaderboard` over `fetchNighthawkCandidateSnapshots(servedEditionFor)`.
- **MARKET REGIME** — read off the `market_regime` object on a `discovery`-stage snapshot row's
  `snapshot_json`. Confirmed via `rank-bucket-analysis-extended.ts`'s own established comment:
  "the ONLY stage that carries the full `market_regime` object — every later stage only keeps the
  scalar `regime_multiplier`." Reused that exact read pattern rather than inventing a new one.
- **SYSTEM CONFIDENCE** — `getNighthawkMetrics(days).by_conviction` mapped through the identical
  Wilson-CI back-derivation the `/record` route already uses (wins derived from `win_rate × decided`,
  never from `n`, which also counts opens — multiplying by `n` would fabricate wins).

**`edition_for` key consistency**: the route resolves the edition first, then uses
`edition.served_for ?? edition.edition_for ?? requestedEditionFor` as the key for the
`candidate_snapshot` fetch — not the raw requested/computed date. `resolveNighthawkEdition` can
carry yesterday's edition forward until close (`carry_until_close`), and candidate_snapshot rows
are written under the date they were actually discovered for, so keying off the raw request would
silently return an empty leaderboard/regime whenever a carry-forward is in effect.

### Fix rationale — what was deliberately left unchanged

- No new tests for this file — consistent with the existing `candidate-leaderboard`/
  `direction-failure-diagnosis` admin routes, which are intentionally thin glue with no dedicated
  test file; the real logic (`buildCommandCenterTable`) already carries 8 unit tests from #6005.
- No change to any member-facing route, gate, score, or publish behavior — purely additive,
  admin-gated, read-only.

### Blast radius

New file only. Nothing else imports or calls this route, so it cannot regress any existing
surface. `npx tsc --noEmit` clean; the composer's own test suite (23 tests across
`command-center-table.test.ts` + `candidate-leaderboard.test.ts`) still passes unchanged.

### Next step

None required by this PR — Phase 2F part 2 (operator priority #14) is now fully wired end to end
(pure composer + live route). A UI surface for this admin route (if the operator wants to actually
view it, vs. just having it queryable) would be a separate, UI-scoped follow-on.
