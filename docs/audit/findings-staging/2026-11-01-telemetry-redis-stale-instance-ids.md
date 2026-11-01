# 2026-11-01 api-telemetry-redis.ts: `readCrossInstanceTelemetry` returns a hollow non-null object instead of `null` when every registered instance id's data key has expired

> **kind:** FINDING

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P2 data-correctness (admin rate-quota headroom panel reads as "ok" when it is not) |

## Root cause

`readCrossInstanceTelemetry()` (`src/lib/api-telemetry-redis.ts`) is the cross-replica telemetry
read the admin API dashboard (`src/lib/admin-api-dashboard.ts`) and `src/lib/market-health.ts`
both call so a multi-replica deploy's true, cluster-wide call volume is visible — a single
replica's own in-memory counter only sees that replica's own calls.

Two Redis keys back this, deliberately set at different TTLs:

```ts
const TELEMETRY_TTL_SEC = 120;
...
await client.set(key, JSON.stringify(payload), "EX", TELEMETRY_TTL_SEC);        // per-instance data, 120s
await client.sadd(`blackout:${INSTANCE_SET_KEY}`, id);
await client.expire(`blackout:${INSTANCE_SET_KEY}`, TELEMETRY_TTL_SEC * 2);       // instance roster, 240s
```

The roster (`INSTANCE_SET_KEY`) is deliberately given 2x the TTL of each instance's own data key
— so a brief flush gap doesn't drop an instance's id from the roster mid-expiry. That design
choice creates a real window: an id can still be `smembers()`-returned from the roster while its
own data key has already expired (e.g. a Redis blip, or an instance that stopped flushing,
longer than 120s but shorter than 240s). `readCrossInstanceTelemetry()` only checked for "no
data at all" in one place:

```ts
const ids = await client.smembers(`blackout:${INSTANCE_SET_KEY}`);
if (!ids.length) return null;                              // <-- only null-check in the function
...
for (const raw of rawRows) {
  if (!raw) continue;                                       // every row can be null here
  ...
  reporting += 1;
  ...
}
return { instances_reporting: reporting, rate_limits, providers };   // returned even if reporting stayed 0
```

If `ids.length > 0` but `mget` returns `null` for every one of them (all expired), the loop body
never runs, `reporting` stays `0`, and the function still returns a **non-null** object:
`{ instances_reporting: 0, rate_limits: {}, providers: {} }`.

Every caller distinguishes "no cluster data" from "real cluster data" purely by null-ness, not
by inspecting `instances_reporting`:

- `deriveClusterCallsByProvider1m()` (`src/lib/api-rate-quotas.ts`): `if (!clusterProviders)
  return localCallsByProvider1m;` — `{}` is truthy, so this branch is skipped, and the function
  returns `{}` (no per-provider keys at all) instead of falling back to the real local counts.
  `buildRateQuotaHeadroom()` then reads every provider via `callsByProvider1m[provider] ?? 0`,
  so every provider's `used_1m` silently becomes `0` and `status` reads `"ok"` — even while the
  replica itself is making real, possibly heavy, calls to that provider.
- `admin-api-dashboard.ts`'s `cluster` field: `crossTelemetry ? {...} : null` — a hollow
  `crossTelemetry` still produces a non-null `cluster` block showing `instances_reporting: 0`
  and empty `by_provider`, which reads as "the cluster really has zero recent traffic" rather
  than "cluster telemetry is temporarily unavailable."
- `market-health.ts`'s `inferredOk`/alert logic (`cross && cross.calls_5m > 0 ? ... : null`) is
  likewise fed a present-but-empty `cross` object instead of `null`.

The net effect: during exactly the window when Redis has been unstable long enough to expire an
instance's data key but not long enough to drop it from the roster — i.e. the moment you most
need an honest "I don't know" rather than a confident wrong number — the dashboard shows a
cluster-wide zero instead of falling back to the one number it actually has (the local replica's
own counter), hiding real rate-quota usage behind a false "ok" status.

## Evidence

Added `readCrossInstanceTelemetry returns null (not a hollow object) when every registered
instance id's data key has expired` to `src/lib/api-telemetry-redis.test.ts`, mocking
`./make-redis` (same pattern as `shared-cache.test.ts`) so `smembers()` returns two instance ids
and `mget()` returns `null` for both — reproducing the exact Redis-state shape this TTL gap
produces.

- **RED (pre-fix, via `git stash` on `src/lib/api-telemetry-redis.ts` alone, test file kept):**
  the new test fails —
  ```
  + { instances_reporting: 0, providers: {}, rate_limits: {} }
  - null
  ```
- **GREEN (post-fix):** `npx tsx --experimental-test-module-mocks --test
  src/lib/api-telemetry-redis.test.ts src/lib/api-telemetry.test.ts src/lib/api-rate-quotas.test.ts`
  — 13/13 pass, no regressions in sibling telemetry/rate-quota suites.
- `npx tsc --noEmit` and `npx eslint src/lib/api-telemetry-redis.ts
  src/lib/api-telemetry-redis.test.ts` — both clean.

## Blast radius

Checked every consumer of `readCrossInstanceTelemetry()` (`git grep -n
readCrossInstanceTelemetry`): `src/lib/admin-api-dashboard.ts` and `src/lib/market-health.ts`.
Both already correctly treat a `null` return as "no cluster data, use local/skip" — the only
defect was that this function wasn't returning `null` for the one case ("ids exist but none of
their data resolved") it had failed to cover. No caller needed any change; fixing the root
function fixes every downstream reader at once, same discipline as the Largo
`buildRichEnvelope()` fix this repo's CLAUDE.md documents for an analogous "shared helper drops
a field" shape.

## Fix rationale

Added a single `if (reporting === 0) return null;` check immediately before the final return,
right after the loop that increments `reporting` only on a successfully-parsed row. This treats
"ids existed but zero of them actually resolved" identically to "no ids at all" — the same
`null` signal every caller already knows how to fall back from — rather than inventing a new
third state. Left the roster/data-key TTL asymmetry itself untouched: it's an intentional design
choice (noted in its own comment) that trades a small window of possible staleness for not
dropping a live instance from the roster on a brief flush gap. A real fix for the asymmetry
would mean changing a tested, deliberate TTL design decision, whereas the actual bug — in how a
hollow result was reported — is independent of that choice.
