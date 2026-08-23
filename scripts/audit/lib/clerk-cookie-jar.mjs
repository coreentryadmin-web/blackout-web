/**
 * A `__session` cookie holder that re-mints the Clerk JWT before it expires.
 *
 * WHY THIS IS SHARED RATHER THAN COPIED (extracted 2026-08-23). Two harnesses already carried a
 * `makeCookieJar` under this exact name and this exact stated purpose, and **they had already
 * drifted**: `gex-force-rebuild-timing.mjs` returned `{ get, force }` so it could re-mint and RETRY
 * on a 401, while `largo-truth-divergence.mjs` returned a bare async function with **no `force` at
 * all** — and the first file's own comment claimed it matched the second's pattern, which had
 * stopped being true. That is the same one-rule-many-copies failure #2731 was entirely about,
 * caught here before a third copy joined them.
 *
 * WHAT IT IS FOR, and it is not bookkeeping. The `__session` JWT dies at roughly 72 seconds. Any
 * harness whose run outlives that loses its session **silently and asymmetrically**: the FIRST
 * items measure fine and the LAST ones return 401 in ~60ms. Read naively that says "the last
 * ticker's matrix is broken and fast", when it says nothing about that ticker at all — measured on
 * `gex-force-rebuild-timing.mjs`'s first run, which reported QQQ 1/5 and IWM 0/5 on a healthy
 * system. `largo-truncation-probe.mjs` hit the same wall from the other side on 2026-08-23: a
 * 4-tool run aborted at the fourth tool with `HTTP 401`, so the tool went unprobed. That abort is
 * honest — it refuses to call the remainder clean — but it capped the probe at two or three tools
 * per invocation, against a lane list of thirteen.
 *
 * THE 45s TIMER IS DELIBERATELY WELL INSIDE THE ~72s LIFETIME. Re-minting on expiry would race the
 * token against the request already in flight; re-minting early costs one extra mint per 45s and
 * removes the race.
 *
 * `force()` is separate from `get()` because a timer alone cannot close the window completely — a
 * token can expire between the check and the server reading it. A caller that sees a 401 should
 * `force()` once and retry; **a 401 that survives a fresh token is a real auth failure**, not a
 * stale cookie, and must be reported rather than retried in a loop.
 */
export function makeCookieJar(session, { maxAgeMs = 45_000 } = {}) {
  let cookie = session?.cookieHeader ?? null;
  let mintedAt = Date.now();

  const force = async () => {
    // A refresh that throws returns null and KEEPS the existing cookie rather than blanking it: a
    // failed re-mint must not turn a working-but-old session into no session at all.
    const next = await session?.refresh?.().catch(() => null);
    if (next?.cookieHeader) {
      cookie = next.cookieHeader;
      mintedAt = Date.now();
    }
    return cookie;
  };

  return {
    async get() {
      return Date.now() - mintedAt < maxAgeMs ? cookie : force();
    },
    force,
  };
}
