## 2026-09-14 — [FINDING, P2 Largo/CI, CORRECTION — no fix needed, prior conclusion in this chain was wrong] The largo-stress-nightly 429s are the app's own per-user concurrency gate firing on the harness's own concurrency setting, not a Cloudflare edge rate limit

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | REPORTED — corrects `2026-09-14-largo-stress-mode1-429-source-identified-cloudflare.md` (shipped via #4971, already merged). That entry's "points at Cloudflare, not app-layer" conclusion does not hold up; this entry replaces it with a code-verified root cause. No code change needed — the harness's existing `askLiveThrottleAware` retry/backoff already handles this correctly, and the 429 itself is the production gate working as designed. |
| **Severity** | P2 — same chain, same class. This entry's only effect is redirecting the "suggested next step" away from a Cloudflare-config investigation that would have found nothing. |

### What the prior entry got wrong, and why

The prior entry inferred a Cloudflare-edge origin for the 429s because every captured `[429 source details]` block contained only `cf-ray`, never `x-ratelimit-*`. That inference doesn't actually discriminate: **`cf-ray` is stamped onto every response that transits the Cloudflare proxy, origin-generated or edge-generated alike** — and the app's own 429 responses (below) are plain `NextResponse.json({error: "..."}, {status: 429})` calls that never set any `x-ratelimit-*` header either. So "only `cf-ray` present" is exactly what an app-layer 429 looks like from outside, not evidence against one. That's the actual error in the prior write-up: the evidence was consistent with both hypotheses, and only one was checked before concluding.

### What's actually happening — verified two ways

**1. The app has a real per-user Largo concurrency gate, exactly on the route the harness hits.** `src/app/api/market/largo/query/route.ts`:

```
const MAX_LARGO_CONCURRENT = 2;
...
async function acquireLargoSlot(userId: string): Promise<LargoSlot> {
  ...
  const key = `largo:active:${userId}`;
  const count = Number(await redis.eval(ACQUIRE_LUA, 1, key, LARGO_TTL_S));
  if (count > MAX_LARGO_CONCURRENT) {
    await redis.decr(key);
    return { acquired: false, redis, localSlot: false };
  }
  ...
}
...
const slot = await acquireLargoSlot(userId);
if (!slot.acquired) {
  return NextResponse.json(
    { error: "Too many active Largo sessions. Please wait for a previous query to complete." },
    { status: 429 }
  );
}
```

A Redis `INCR`-based per-user counter, capped at 2 concurrent in-flight Largo queries, rejecting the 3rd with a bare `{status: 429}` — no rate-limit headers, `cf-ray` still stamped on the way out through Cloudflare. This is a real production safety gate (documented inline as protecting against unbounded concurrent Claude tool-loops per user), not a bug.

**2. `scripts/largo-stress-run.mjs` runs all its concurrent workers as the SAME user/session, and its own header comment already documented this exact mechanism before this correction was written:**

```
* The first production run returned 429 for 9 of 12 questions at concurrency 3 and the scorer
* recorded them as WARN / "too-short" ...
```

and the worker loop itself:

```js
const concurrency = Math.max(1, Number(process.env.LARGO_STRESS_CONCURRENCY) || 1);
...
async function worker() {
  while (idx < entries.length) {
    const i = idx++;
    let res = await askLiveThrottleAware(await freshCookie(), entry.q);
    ...
  }
}
await Promise.all(Array.from({ length: concurrency }, () => worker()));
```

`freshCookie()`/`live.cookieHeader` is one shared Clerk session for the whole run — every worker authenticates as the identical `userId`. The scheduled/no-input path sets `LARGO_STRESS_CONCURRENCY=2`, i.e. exactly at `MAX_LARGO_CONCURRENT`. At that boundary, any timing overlap — a slot's Redis `DECR` on release racing a new worker's `INCR` on acquire, or a still-draining "deep" Largo turn (measured elsewhere in this chain at 30-38s `loop_ms`) holding its slot while the harness has already moved on to the next question — pushes the live count to 3 and trips the gate. The harness's own `askLiveThrottleAware` wrapper (retry with backoff, SKIP-not-WARN classification) exists specifically because this was already known to happen.

### Why this matters

- **No Cloudflare-side action needed.** The prior entry's suggested next step (check the CF rate-limiting ruleset for `blackouttrades.com`) was chased down this cycle: `GET /zones/{id}/rulesets` lists every ruleset in the zone and there is no `http_ratelimit`-phase entry at all — confirming, independently, that there is no CF-side rate-limiting rule to find. (Also checked AWS WAFv2 `get_web_acl_for_resource` on the prod ALB — `None`, no WebACL attached — ruling out an AWS-side WAF rate-based rule too.) Both were live, real checks, not assumptions.
- **The 429 rate is a property of the harness's own concurrency setting against a real, intentional production limit**, not an external condition to negotiate with. Lowering `LARGO_STRESS_CONCURRENCY` to 1 would eliminate the 429s (at the cost of a longer-running suite); leaving it at 2 accepts some throttling as the cost of finishing faster. That's the actual judgment call — same "not something to guess at from this sandbox" disposition as the rest of this chain, just correctly scoped now to the harness's own env var rather than a Cloudflare dashboard nobody needed to touch.
- **Coverage-loss framing from the prior entry stands independent of the source correction** — 35% loss this run is real regardless of which system generated the 429; only the "where do I look to change it" pointer was wrong.

### Not fixed here

Same as the rest of the chain: whoever owns `largo-stress-nightly.yml`/`largo-stress-run.mjs` decides whether to drop `LARGO_STRESS_CONCURRENCY` to 1 (trading suite duration for zero self-inflicted 429s) or keep it at 2 and accept the SKIP rate — both are reasonable, this entry's job is only to make sure that decision is made against the real mechanism.

### Suggested next step

1. If full coverage matters more than suite runtime: set `LARGO_STRESS_CONCURRENCY=1` (or 0/unset, same default) for the scheduled run — at concurrency 1 there is no way to exceed `MAX_LARGO_CONCURRENT=2` from one shared session, so the 429 path should go to ~0.
2. If the ~2x speedup from concurrency=2 is worth keeping some SKIPs for: no change needed, `askLiveThrottleAware` already retries with backoff and SKIPs correctly exclude from the quality tally rather than corrupting it.
3. **Retract/close out the "check Cloudflare rate-limiting ruleset" suggestion from the prior entry** — done here, confirmed empty ruleset, no further CF-side investigation warranted for this specific 429 pattern.
