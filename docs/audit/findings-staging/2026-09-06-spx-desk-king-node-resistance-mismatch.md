## 2026-09-06 — [FINDING, SPX Slayer desk, P2] King node level disagreed on `kind` between initial build and live merge — FIXED

> **kind:** `FINDING`

### Symptom

Found during a DISCOVERY-lane sweep of the SPX Slayer desk for the population/cohort/order-mismatch
and mutate-in-place bug classes already fixed repeatedly elsewhere this session. SPX Slayer came
back clean on the mutate-in-place class (~60 `.sort()` sites checked, all copy-first or operate on
freshly-built local arrays), but surfaced a genuine two-copies-disagree defect on the "King node ·
GEX anchor" level.

### Root cause

`src/features/spx/lib/spx-desk.ts` (the server-side initial desk build, `buildSpxDesk()`) and
`src/features/spx/lib/spx-desk-merge.ts` (the client-side pulse/flow merge, used by
`useMergedDesk.ts` to fold live updates on top of the initial payload) each carried their own
private, near-identical `buildLevels()` — same 13 levels, same fields, same sort — that had drifted
apart on exactly one line. The merge file's copy read:

```ts
// Anchor = argmax|net_gex|; it's often the PUT wall (support) and may sit below spot,
// so it carries no directional meaning — mark it neutral (sky/gold) to match the
// Heatmap ANCHOR node + Dealer Desk gold treatment, not unconditional resistance/red (#80).
level("King node · GEX anchor", input.gex_king, p, "neutral"),
```

while the initial-build file's copy still had:

```ts
level("King node · GEX anchor", input.gex_king, p, "resistance"),
```

Issue #80 fixed the King node's `kind` in the merge file only — the initial-build file's
independent copy was never updated to match. Concrete failure: on first page load the King node
level renders `resistance` (red, "unconditional resistance" per the merge file's own comment about
what that label implies); the instant the client applies its first live pulse/flow merge, the same
strike and same `net_gex` recompute to `neutral`, for no price-moving reason. If the King node is
actually the PUT wall (support, sometimes below spot — the exact case #80 was written for), the
initial paint is simply wrong, and the visible level swaps color/label mid-session with nothing to
justify it.

### Fix

Extracted the shared `buildLevels()` (and its `level()` helper) into a new
`src/features/spx/lib/spx-desk-levels.ts`, matching this codebase's own established pattern for
exactly this problem — `spx-desk-numerics.ts` and `spx-vwap-proxy.ts` already exist for the same
reason (server-only-free, unit-testable pure logic pulled out of `spx-desk.ts`'s heavy provider
import chain). Both `spx-desk.ts` and `spx-desk-merge.ts` now import the single implementation
instead of maintaining independent copies that can silently re-diverge. This is a structural fix,
not just a value correction — a future edit to the shared level logic can no longer land in one
copy and not the other.

### Evidence

- RED→GREEN: `git stash push -u` the new module + both call-site edits (keeping the new test) →
  test fails (`spx-desk-levels` module not found) → `git stash pop` → 4/4 pass.
- New regression tests in `spx-desk-levels.test.ts`: King node is `neutral`; the full kind-per-label
  contract (HOD/PDH resistance, PDL/LOD support, everything else neutral); sort + null-filtering
  behavior; and a **source-scan drift guard** that fails loudly if either `spx-desk.ts` or
  `spx-desk-merge.ts` ever redefines `buildLevels` locally instead of importing the shared one —
  the same class of guard `meridian-thermal-scope.test.ts` already uses for an analogous
  two-files-must-agree contract.
- `npx tsc --noEmit`: clean.
- Full `npm test` (Node 20): see PR for final count.

### Also fixed in the same PR — 1 confirmed-dead export (SPX Slayer desk, same sweep)

`src/features/spx/lib/spx-play-memory-id.ts` — `resetMemoryPlayIds()`, self-labeled "test helper"
in its own comment but with zero callers anywhere in the repo, including its own module's test
suite (grep-verified before/after: 1 file → 0 files). Removed; its sibling `nextMemoryPlayId` (the
module's real, actively-used export) is untouched.

### Blast radius

`spx-desk.ts`, `spx-desk-merge.ts` (both lose their private `buildLevels`/`level`, gain one import
each), new `spx-desk-levels.ts`, new `spx-desk-levels.test.ts`, and `spx-play-memory-id.ts`.
No other consumer of either file's `buildLevels` exists (both were called only from their own
module's desk-build functions, verified by grep).

| **Status** | FIXED — PR opened, merge pending CI/peer-review per standing policy |
