## `/api/worker/ready`'s Polygon-indices readiness check was gated on `uwConfigured()` instead of `polygonConfigured()`

> **kind:** `FINDING`

### Root cause

`src/app/api/worker/ready/route.ts` computes two independent readiness flags — one for the
Unusual Whales socket (`uwOk`) and one for the Polygon indices socket (`indicesOk`):

```ts
const uwOk = !uwConfigured() || (uw.initialized && !uw.auth_failed);
const indicesOk =
  !uwConfigured() ||
  indices.authenticated ||
  indices.wsState === "OPEN" ||
  indices.wsState === "CONNECTING";
```

`indicesOk` is meant to be a no-op gate ("don't fail readiness over a provider this deployment
doesn't even use") exactly like `uwOk` is for UW — but it checks `uwConfigured()` again instead of
`polygonConfigured()` (`src/lib/providers/config.ts`, which exists specifically for this purpose
and is already the gate `api/market/indices`, `api/market/heatmap`, and `api/market/news` use for
the same provider). This reads as a copy-paste of the line directly above it that was never
updated to reference the right provider.

The route has carried this since it was introduced in #709 and has never been touched since —
confirmed via `git log -p --follow` on the file.

### Evidence

Added `src/app/api/worker/ready/route.test.ts`. Confirmed RED against the pre-fix source (`git
stash` isolating `route.ts`): with `uwConfigured() === false` and `polygonConfigured() === true`,
and the Polygon indices socket genuinely down (`authenticated: false`, `wsState: "CLOSED"`), the
route returned `{ ok: true }` / HTTP 200 — a false-positive readiness signal. Post-fix: 3/3 pass,
`tsc --noEmit` clean.

### Blast radius

Single call site — this is the only place in the repo that reads `getIndexStoreStatus()` to decide
readiness. The fix changes only which config flag gates `indicesOk`; `uwOk`'s own gate is
untouched.

**Concrete failure scenario this fixes:** any deployment/environment where `UW_API_KEY` is absent
but `POLYGON_API_KEY` is present (e.g. a Polygon-only worker variant, or a misconfigured/partial
env) would report `/api/worker/ready` as ready (HTTP 200) even while the Polygon indices WebSocket
is completely down — the orchestrator could route traffic to the worker, or a deploy's health gate
could proceed, before the index feed is actually live. In the common case where both providers are
configured (`uwConfigured()` true), the bug was latent: `!uwConfigured()` evaluates false either
way, so the real indices check still ran and masked the wrong-flag bug in that specific
configuration.

### Fix rationale

Swap `uwConfigured()` for `polygonConfigured()` in the `indicesOk` guard only — same shape, same
intent ("skip this provider's readiness requirement when the provider isn't configured at all"),
now pointed at the provider the check is actually about. No behavior change for `uwOk`, no change
to the socket-health functions themselves.

| **Status** | Fixed in PR #TBD (branch `fix/worker-ready-indices-polygon-gate`) |
|---|---|
