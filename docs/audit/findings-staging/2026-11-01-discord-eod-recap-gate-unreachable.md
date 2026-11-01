> **kind:** FINDING

## Dark pool + HELIX Discord EOD recap was unreachable in production — missing EOD-window carve-out in the top-level RTH gate

| | |
|---|---|
| **Area** | Discord community alerts — `darkpool-discord` + `helix-discord-digest` crons |
| **Severity** | P2 (fully-built, tested feature never fires in production; no data corruption) |
| **Status** | Fixed |

### Root cause

Both `src/app/api/cron/darkpool-discord/route.ts` and
`src/app/api/cron/helix-discord-digest/route.ts` gate their entire tick behind:

```ts
if (!force && rthOnly() && !isEtCashRth()) { ...skip... }
```

Both routes also implement a dedicated **end-of-day recap** branch
(`isDiscordEodRecapWindow` / `buildDarkpoolEodRecapEmbed` / `buildHelixEodRecapEmbed`,
`src/lib/discord-eod-recap.ts`) meant to fire once, ~4:04–4:14 PM ET, after the cash session
closes. But `isDiscordEodRecapWindow()` is defined as:

```ts
export function isDiscordEodRecapWindow(now = new Date()): boolean {
  if (isEtCashRth(now)) return false;   // <-- only true OUTSIDE cash RTH
  ...
  return hour === 16 && minute >= 4 && minute <= 14;
}
```

So the EOD window **only ever exists outside cash RTH** — which is exactly the condition the
top-level gate treats as "skip". Under the default config (`DARKPOOL_DISCORD_RTH_ONLY` /
`HELIX_DISCORD_DIGEST_RTH_ONLY` both unset ⇒ `true`), every tick landing in the 4:04–4:14 PM ET
window hit `!force && rthOnly() && !isEtCashRth()` ⇒ `true` and returned `"Outside cash RTH"`
*before* `runDarkpoolDiscordTick` / the HELIX EOD branch ever ran. The EOD recap code —
fully implemented, deliberately engineered (HELIX's branch even does its own dedicated
session-wide `fetchRecentFlows` call specifically to avoid under-counting early-session flow,
per its own in-code comment) — was dead code in production with no error, no log line pointing
at it, and no failing test: it simply never executed.

The sibling `src/app/api/cron/thermal-discord/route.ts` already has the correct pattern and
proves this was the intended design, not a feature nobody wanted gated this way:

```ts
const isRth = isEtCashRth(now);
const eodDue = isThermalEodRecapDue(now);
if (!force && thermalDiscordRthOnly() && !isRth && !eodDue) { ...skip... }
```

Thermal's gate explicitly carves out the EOD window; darkpool-discord's and
helix-discord-digest's never got the equivalent `&& !isDiscordEodRecapWindow(now)` clause.

### Evidence

- `src/lib/discord-eod-recap.ts`'s own `isDiscordEodRecapWindow` short-circuits to `false`
  whenever `isEtCashRth(now)` is `true` — by construction, every timestamp where it returns
  `true` is a timestamp where `!isEtCashRth(now)` is also `true`.
- Added a logic test (`a timestamp inside the EOD-recap window is genuinely outside cash RTH`,
  both route test files) using a real trading day/time (2026-09-09 20:08 UTC = 4:08 PM ET under
  EDT) and the real imported `isEtCashRth`/`isDiscordEodRecapWindow` functions: confirms
  `isEtCashRth === false` and `isDiscordEodRecapWindow === true` simultaneously — the exact
  precondition that made the old gate wrongly skip.
- `railway.darkpool-discord.toml` runs the cron every 2 minutes across UTC 11–21 (covers the
  4:04–4:14 PM ET band every session day under both EDT and EST), so in production this was not
  a rare edge case — it fired, and was skipped, every single trading day.
- Added a source-regex regression test per route asserting the gate literally contains
  `!isEtCashRth(now) && !isDiscordEodRecapWindow(now)`; confirmed **RED** against the pre-fix
  gate (`!isEtCashRth()` alone) by reverting just that expression and re-running — 2 failures,
  the two new gate tests, 7 pre-existing tests still passing — then **GREEN** after restoring
  the fix. `tsc --noEmit` clean on the full project both before test-writing and after the fix.

### Blast radius

Two call sites, same root cause, same fix shape:
- `src/app/api/cron/darkpool-discord/route.ts` — dark-pool EOD recap (`#blackout-darkpool`).
- `src/app/api/cron/helix-discord-digest/route.ts` — HELIX EOD recap (`#blackout-helix`).

`src/app/api/cron/thermal-discord/route.ts` was checked and already has the correct pattern
(`!isRth && !eodDue`) — not touched; it served as the reference for this fix. No other caller of
`isDiscordEodRecapWindow` exists in the repo.

### Fix rationale

Mirror the already-correct `thermal-discord` pattern exactly rather than inventing a new shape:
hoist `const now = new Date()` above the top-level gate (it was previously declared just below
it, purely for the per-minute digest cadence check) and add `&& !isDiscordEodRecapWindow(now)` to
the skip condition in both routes. This is the minimal change that makes the EOD branch reachable
without altering any other gating behavior (dedup, force/allow_dup bypass, digest cadence, or the
breach/burst-flush logic untouched in either file). Considered instead inlining a bespoke
`eodDue` boolean (matching thermal-discord's exact local variable name) but kept the gate as a
single inline expression consistent with how both routes already express their
`!force && rthOnly() && ...` condition — a smaller diff with identical runtime behavior.
