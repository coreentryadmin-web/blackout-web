> **kind:** FINDING

## `audit-auth-fetch.mjs`'s cron-bearer success path crashes the whole audit script on a 200 with an unparseable body, instead of falling through to the Clerk fallback — FIXED

**Status:** FIXED (`fix/audit-auth-fetch-cron-json-crash`)

### Root cause

`scripts/audit/lib/audit-auth-fetch.mjs` is the shared "CRON bearer first, Clerk
session fallback" authenticated-fetch helper underneath most of this repo's audit
scripts (`legacy-e2e-healthcheck.mjs`, `swing-early-trim-ab.mjs`,
`swing-score-calibration.mjs`, `swing-loss-taxonomy-segment.mjs`,
`zerodte-session-replay.mjs`, `meridian-data-validator.mjs`, and ~60 more). Its
whole design point, per its own header comment, is resilience: "Cloud-agent
`CRON_SECRET` often mismatches prod Secrets Manager; Clerk temp-user auth is the
authoritative member-path fallback."

`fetchAuditJsonOnce`'s cron-bearer branch had:

```js
if (r.ok) return { ok: true, status: r.status, json: await r.json(), via: "cron" };
// ...
if (!fallThrough) {
  const json = await r.json().catch(() => ({}));
  return { ok: false, status: r.status, json, via: "cron" };
}
```

The `r.ok` (success) branch called `await r.json()` with **no guard**, while the
sibling non-ok branch three lines below it guards the identical call with
`.catch(() => ({}))`. A `fetch()` response can be `ok: true` (status 2xx) with a
body that is not valid JSON — a mismatched/typo'd route serving an HTML error page,
a Cloudflare interstitial, or any 200/204-shaped empty body — and `r.json()` then
throws a `SyntaxError`.

Nothing up the call chain catches it: `fetchAuditJson`'s retry loop calls
`fetchAuditJsonOnce()` with no `try/catch` around it, so the exception propagates
all the way out of the exported `fetchAuditJson` and kills the entire calling
script — exactly the failure mode this dual-auth module exists to prevent (a stale
`CRON_SECRET` or a bad route should fall through to the "authoritative" Clerk
member-path, never crash the run).

### Evidence

New regression test (`scripts/audit/lib/audit-auth-fetch.test.mjs`), RED before the
fix / GREEN after (proven via `git stash`/`git stash pop` against this PR's own
diff):

- Mocking `fetch` to return `{ ok: true, status: 200, json: () => throws
  SyntaxError }` for the cron-bearer call: **before the fix**, `fetchAuditJson()`
  threw the `SyntaxError` out to the caller. **After the fix**, it returns a
  graceful `{ ok: false, ... }` (no Clerk keys configured in that test case) instead
  of crashing.
- A second case with Clerk keys configured proves the INTENDED fallback actually
  fires once the crash is removed: the cron call still returns the unparseable
  200, and `fetchAuditJson` now falls through and returns the Clerk-cookie call's
  real result (`ok: true, via: "clerk"`), minting exactly one Clerk session.
- A third case (200 + valid JSON) proves the common/healthy cron path is
  unchanged — no regression there.

### Blast radius

Every caller of the exported `fetchAuditJson` is exposed to the same crash any time
the configured `CRON_SECRET` happens to hit a route that returns 2xx with a
non-JSON body (stale secret matching an unintended route, a redirect Node's
`fetch` auto-follows into a static HTML page, a misconfigured health-check-style
endpoint). That is dozens of call sites across `scripts/audit/*.mjs` (grep for
`audit-auth-fetch` — ~70 files), none of which wrap their own calls in a
`try/catch`, because the whole point of this shared helper is that they shouldn't
have to.

### Fix rationale

Guard the `r.ok` branch's `r.json()` call with the exact same `.catch(() =>
undefined)` pattern the non-ok branch already uses three lines down, and treat an
unparseable 2xx the same way a 401/403 is already treated: fall through to the
Clerk member-path rather than report a false "ok" or crash. This fixes the
asymmetry at its single source (the one place both outcomes are decided) instead
of wrapping every one of the ~70 call sites in their own `try/catch`. Deliberately
left unchanged: the Clerk branch's own `r.json().catch(() => ({}))` (already
correct), and the retry/backoff logic in `fetchAuditJson` (orthogonal to this bug —
a 200 is never transient, so no change to the retry decision is needed here).
