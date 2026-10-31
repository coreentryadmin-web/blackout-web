> **kind:** FINDING

## `AdminOperationsDashboard.tsx` "Premium launch gate" vital reads the correct, intended default state as DEGRADED — FIXED

| | |
|---|---|
| **Area** | Admin → Operations Center → System Vitals → "Premium launch gate" row |
| **File** | `src/components/admin/AdminOperationsDashboard.tsx` (fix extracted new pure helper `src/components/admin/admin-launch-gate-health.ts`) |
| **Status** | FIXED |
| **Severity** | P3 — cosmetic/operational (a false red "degraded" indicator in an internal admin ops panel; no member-facing impact, no data-correctness impact) |

### Root cause

The "Premium launch gate" `VitalRow`'s `ok` flag was computed inline as:

```ts
ok={
  h?.launch_status
    ? h.launch_status.open_count === h.launch_status.total_count ||
      (h.launch_status.open_count === 5 &&
        h.launch_status.locked_keys.length === 1 &&
        h.launch_status.locked_keys[0] === "largo")
    : null
}
```

The `open_count === 5` branch is a **hardcoded magic number** that encodes "exactly one tool (Largo) is locked, and that's fine" — but it bakes in a specific `open_count`, which is derived as `TOOLS.length - lockedCount` in `src/lib/tool-access.ts`'s `getLaunchStatusSnapshot()`. `TOOLS.length` is NOT a constant: it grows every time a new tool ships.

This check was added in commit `d22ee2b1d` ("Launch all premium tools except Largo", 2026-07-05), when `TOOLS` had exactly 6 entries (spx, flows, heatmap, largo, nighthawk, vector) — 5 `defaultLaunched: true` + 1 locked (largo) — so `open_count === 5` was correct **at that moment**.

Meridian was added as a 7th tool shortly after (`d05c92489`/`c06871e5e`, PRs #2250/#2251), and currently ships with `defaultLaunched: true`:

```ts
// src/lib/tool-access.ts
export const TOOLS: readonly ToolMeta[] = [
  { key: "spx", ..., defaultLaunched: true },
  { key: "flows", ..., defaultLaunched: true },
  { key: "heatmap", ..., defaultLaunched: true },
  { key: "largo", ..., defaultLaunched: false },   // the one intentional lock
  { key: "nighthawk", ..., defaultLaunched: true },
  { key: "vector", ..., defaultLaunched: true },
  { key: "meridian", ..., defaultLaunched: true },  // added later, 7th tool
] as const;
```

So in the real, current, intended default state (`LAUNCHED_TOOLS` unset, only Largo locked):
`total_count = 7`, `open_count = 6`, `locked_keys = ["largo"]`.

The old inline check tests `open_count === 5`, which is now **always false** in this state (`6 !== 5`), and `open_count === total_count` is also false (`6 !== 7`) — so `ok` evaluates to `false`, rendering a red pulsing dot on the "Premium launch gate" vital for the admin, even though the system is in exactly the state the product intends (every tool live except the deliberately-gated Largo). Nobody would ever see this row read green under normal operation — it has been silently wrong since Meridian's default-launch flip.

### Evidence

- `git log -S"open_count === 5" -- src/components/admin/AdminOperationsDashboard.tsx` → introduced in `d22ee2b1d`, whose own commit message says "treat 5/6 open (Largo locked) as healthy" — explicit confirmation the `5` was tied to a 6-tool total that no longer holds.
- `git log -p --follow -- src/lib/tool-access.ts | grep -n meridian` → Meridian added in `d05c92489`/`c06871e5e` (#2250/#2251) as the 7th `TOOLS` entry, `defaultLaunched: true` in the current source.
- Direct read of `src/lib/tool-access.ts`'s `TOOLS` array today: 7 entries, `defaultLaunched: false` only for `"largo"` → `getLaunchStatusSnapshot()` with `LAUNCHED_TOOLS` unset yields `{ open_count: 6, total_count: 7, locked_keys: ["largo"] }`.
- RED→GREEN proof (new regression test `src/components/admin/admin-launch-gate-health.test.ts`): reinstating the old inline expression as `oldHardcodedCheck()` and feeding it the real current default state (`{ open_count: 6, total_count: 7, locked_keys: ["largo"] }`) returns `false` (bug reproduced); the new `launchGateHealthy()` helper returns `true` for the same input (fix verified). Also independently confirmed by temporarily swapping the fixed helper's body for the old buggy expression and re-running the full test file: 2/4 tests failed (RED); restoring the fix brought all 4 back to green.

### Blast radius

Single call site — the inline `ok` expression only appeared once, on the "Premium launch gate" `VitalRow` in `AdminOperationsDashboard.tsx`. `DataPipelineHealthTile` and the rest of the System Vitals panel don't duplicate this logic. No other component reads `LaunchStatusSnapshot.open_count`/`locked_keys` to derive a boolean health flag (checked via `grep -rn "launch_status" src --include="*.tsx"`), so this was not a duplicated-logic bug, just one stale magic number.

### Fix rationale

Extracted the health check into a pure, testable helper (`launchGateHealthy()` in `src/components/admin/admin-launch-gate-health.ts`, following the same pattern already used in this folder for `admin-store-age.ts`/`admin-time-ago.ts`/`admin-operations-audit-request-guard.ts`) that drops the hardcoded `open_count === 5` branch entirely:

```ts
export function launchGateHealthy(status: LaunchGateStatus): boolean {
  if (status.open_count === status.total_count) return true;
  return status.locked_keys.length === 1 && status.locked_keys[0] === "largo";
}
```

`locked_keys.length === 1 && locked_keys[0] === "largo"` already fully implies "exactly one tool is locked and it's Largo" — the matching `open_count` follows automatically from `total_count - 1` and never needs to be spelled out as a separate, driftable number. This keeps the same product intent (Largo being the only locked tool is healthy) correct at any `TOOLS.length`, including the next tool that ships.

Deliberately left unchanged: the `sub` copy ("LAUNCHED_TOOLS unset (defaults: all except Largo)") and the `value` display (`"{open}/{total} open"`) — both were already correct, only the `ok` boolean was stale. No change to `src/lib/tool-access.ts` itself; this is purely a dashboard-side presentation fix.

### Verification

- New test file `src/components/admin/admin-launch-gate-health.test.ts` (4 tests, all GREEN): healthy-at-any-count, only-largo-locked-healthy-at-any-count (incl. a hypothetical 8-tool future), anything-else-locked-is-degraded, and the direct regression reproduction above.
- `npx tsc --noEmit` clean.
- `npx eslint src/components/admin/admin-launch-gate-health.ts src/components/admin/admin-launch-gate-health.test.ts src/components/admin/AdminOperationsDashboard.tsx` clean.
- Existing `src/lib/tool-access.test.ts` (7 tests) and the sibling `admin-store-age.test.ts`/`admin-operations-audit-request-guard.test.ts` files still pass unchanged.
