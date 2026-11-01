> **kind:** FINDING

## HELIX deep-link resolution silently fails for REST-sourced rows (premium parsed as $0 instead of absent)

| | |
|---|---|
| **Area** | HELIX flow tape — `/flows?alert=...&ticker=...` deep links (Discord → member click-through) |
| **Status** | Fixed |

### Root cause

`parseHelixDeepLink` (`src/lib/helix-flow-deep-link.ts`) built its `flow`-kind target with:

```ts
premium: Number(searchParams.get("premium")),
```

`URLSearchParams.get(...)` returns `null` when a param is absent, and `Number(null)` evaluates to
`0` in JavaScript — a perfectly finite number, not `NaN`. The sibling `strike` field two lines
above already guards against exactly this (`strikeRaw != null ? Number(strikeRaw) : null`), but the
same guard was missing for `premium`.

Every HELIX Discord embed link is built by `buildHelixFlowDeepLink`, which **returns early** the
moment `alert_id` is present (the common case — most persisted flows carry one):

```ts
if (input.alert_id?.trim()) {
  params.set("alert", input.alert_id.trim());
  params.set("ticker", ticker);
  return `${APP_BASE}/flows?${params.toString()}`;
}
```

So an alert-id link never carries a `premium` (or `strike`/`expiry`/`at`) query param at all. On
the receiving end, `flowMatchesDeepLink`'s own comment names the exact scenario this breaks:

```ts
if (target.alert_id && !flow.alert_id) {
  // REST rows may omit alert_id — fall through to contract match below.
}
```

When the live tape row being matched against the link is a REST-sourced `FlowAlert` without an
`alert_id` (exactly the case this comment anticipates), the function falls through past the
early-return and reaches:

```ts
if (target.premium != null && Number.isFinite(target.premium)) {
  const flowPrem = flow.premium != null && Number.isFinite(flow.premium) ? Math.round(flow.premium) : 0;
  if (flowPrem !== Math.round(target.premium)) return false;
}
```

With the bug, `target.premium` is `0` (not `null`) — a real, present, finite value — so this check
runs and requires the row's premium to equal exactly `$0`. A genuine flow print's premium is always
`> 0`, so the comparison always fails and `flowMatchesDeepLink` returns `false` for every row it
should otherwise match on ticker + presence of `alert_id`.

### Evidence

Reproduced directly against the real functions (no mocking):

```
target: {
  kind: 'flow', ticker: 'NVDA', alert_id: 'uw:99',
  strike: null, expiry: null, option_type: null, at: null,
  premium: 0          // <- should be null ("unknown"), not a real $0
}
matches: false          // <- should be true (ticker + alert_id intent both agree)
```

Added two regression tests to `src/lib/helix-flow-deep-link.test.ts`:
1. `parseHelixDeepLink leaves premium unset — not $0 — when the URL carries no premium param`
2. `flowMatchesDeepLink falls back to alert_id+ticker when the matched row has no alert_id`

Both FAIL on the pre-fix code (confirmed via `git stash` isolating the source change from the test
change — `flowMatchesDeepLink` returned `false` instead of the expected `true`) and PASS after the
fix. Full existing suite (`src/lib/helix-flow-deep-link.test.ts`, 14 tests, plus
`src/lib/helix-discord-format.test.ts`) stays green.

### Blast radius

- `src/features/helix/lib/use-helix-deep-link.ts` (`useHelixDeepLink`) is the live client path that
  calls `flowMatchesDeepLink` against the `/flows` page's real `alerts: FlowAlert[]` array (a REST
  feed) to auto-select and highlight the contract a shared Discord link points at. This bug meant a
  member clicking a shared HELIX alert link would silently fail to have the contract
  highlighted/selected whenever the live tape still only held that print as a REST-sourced row
  (no `alert_id`) — no error, just the click doing nothing.
- `deepLinkResolutionKey` / `contractKey` already null-guard `target.premium` correctly, so they
  were not affected by the `0` vs `null` distinction — only the `flowMatchesDeepLink` premium
  veto was.
- The sibling `darkpool`-kind branch of `parseHelixDeepLink` was not touched: `buildHelixDarkpoolDeepLink`
  always supplies both `at` and a real, required (non-optional) `premium`, so that branch's params
  are never absent in practice and the `Number(null)=0` trap does not apply there the same way.

### Fix rationale

Mirrored the exact guard the `strike` field already uses two lines above: read the raw param,
convert to `null` when absent, and only keep a finite number. This is the minimal, targeted fix —
no behavior changes for any link that legitimately carries a premium (including the already-tested
cents-rounding case), only for the case where the param is genuinely absent, which previously
corrupted it into a false "$0" requirement.
