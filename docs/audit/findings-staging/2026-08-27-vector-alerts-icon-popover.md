> **kind:** FINDING

## Vector Alerts panel relocated to a bell icon popover (operator UI request) — FIXED

| **Status** | FIXED in `fix/vector-alerts-icon-and-play-card` |
| **Severity** | P3 — desk UX (operator-requested, not a defect) |
| **Surface** | `/vector` standalone page (chartOnly SPX Slayer embed unaffected — see below) |

### Ask (verbatim, operator, 2026-08-27)

> "I don't think anyone right now is using Alerts on Vector — we might as well remove it and just
> add a clickable icon next to LIVE SESSION on the top and it gives us options."

### What changed

The standalone `VectorAlertsPanel` block (ticker/condition/threshold/"+ Add" form, rule list,
notify toggle) was a persistent full-width row in the desktop action rail
(`src/features/vector/components/VectorPageShell.tsx`'s `actionRail`), always taking up vertical
space regardless of whether the member had any rules set up.

It is now a bell-icon button anchored directly beside the "Live session" freshness chip near the
top of the page (the badge the operator called "LIVE SESSION"), which opens the exact same
controls in an anchored popover. Clicking away, clicking the bell again, or pressing Escape closes
it. A small dot on the bell indicates at least one enabled rule, so the control still communicates
state at a glance even collapsed.

### Design decisions

- **`VectorAlertsPanel.tsx` itself is untouched** — same props, same JSX, same add/toggle/remove/
  notify logic. The only new file is `VectorAlertsBell.tsx`, which renders the unmodified panel
  inside a popover shell. This was a deliberate scope boundary: the ask was "move where this
  lives", not "rebuild how alerts work", and alert evaluation/firing code
  (`vector-alerts-store.ts`, `vector-notify*.ts`, the chart's own rule evaluation) was not touched
  at all.
- **No existing generic Popover primitive to reuse** — checked `grep -rn Popover src/components
  src/features`; the only hits are Clerk's `userButtonPopoverCard` theme keys (styling knobs for
  Clerk's own `<UserButton>`, not a component). Rather than adding a new dependency for one
  control, `VectorAlertsBell` composes two patterns already established in this repo: the
  click-outside-to-close listener from `src/components/ui/Select.tsx`'s dropdown, and the shared
  `useFocusTrap` hook (`src/components/ui/useFocusTrap.ts`) already used by every hand-rolled
  dialog here, with `lockScroll: false` since a small anchored popover shouldn't freeze page
  scroll the way a full modal does.
- **The chartOnly SPX Slayer embed is intentionally excluded.** That embed already never rendered
  the standalone Alerts panel (only the chart + toast), per a 2026-08-05 member directive keeping
  it panel/terminal-free; wiring the bell only into the full standalone page's `trailSlot`
  (`chartFreshnessWithAlerts`, kept separate from the plain `chartFreshness` the embed still uses)
  preserves that untouched.

### Blast radius

- `src/features/vector/components/VectorPageShell.tsx`: `VectorAlertsPanel` import replaced with
  `VectorAlertsBell`; `actionRail` no longer mounts it; a new `chartFreshnessWithAlerts` variable
  groups the freshness chip + bell for the standalone page's chart `trailSlot` only.
- `src/app/globals.css`: new `.vector-alerts-bell-*` / `.vector-freshness-alerts-group` rules; no
  existing `.vector-alerts-*` rule was changed (the popover reuses the panel's own styling as its
  surface, just adding a drop shadow and repositioning).
- `src/features/vector/vector-ios-native.test.ts`: the pre-existing action-rail test asserted
  exactly one `<VectorAlertsPanel` in the shell; updated to assert it is gone from the shell
  entirely and `<VectorAlertsBell` is present instead (source-invariant test, no render harness
  for this component family).

### Evidence

- `npx tsc --noEmit` clean.
- New `VectorAlertsBell.test.ts` (6 assertions: unmodified panel rendered inside the popover with
  every prop forwarded unchanged, click-outside/Escape wiring present, the panel's own
  add/toggle/remove/notify logic untouched, the shell no longer imports/mounts the panel directly,
  the bell is wired to the exact same alert state the old panel used, and the chartOnly embed's
  `trailSlot` is unaffected) — all pass on Node 20.
- Updated `vector-ios-native.test.ts` — all 8 tests in that file pass.
- Full `src/features/vector` test sweep: 1208/1215 pass; the 7 failures
  (`vector-shared-universe-cache`, `vector-stream-hub`, `vector-universe`,
  `vector-wall-durable-queue`, `vector-wall-sample-server`, `vector-wall-write`,
  `vector-walls-warm`) are pre-existing, untouched by this change, and reproduce identically on an
  unmodified checkout (confirmed by re-running `vector-universe.test.ts` in isolation) —
  infra-dependent (these hit a real Redis/DB connection this sandbox doesn't have), not a
  regression from this PR.
- Live before/after screenshots were not captured: the "after" state only exists on this unmerged
  branch, and `proxy-browser.cjs` can only reach the deployed production site, not this worktree —
  there is no pre-prod render target since the 2026-07-25 staging decommission (see
  `CLAUDE.md`'s Vector E2E section). A post-deploy screenshot can confirm the popover visually
  once this merges.
