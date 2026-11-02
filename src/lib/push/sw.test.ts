import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

/**
 * `public/sw.js` is a classic, unbundled service-worker script (no `import`/`export`,
 * registered without `{ type: "module" }` — see `PwaRegister.tsx`), so there is nothing
 * for a normal `import` to grab. Loading the REAL source into a sandboxed `vm` context
 * and reading back the top-level `function` declarations it defines on that context's
 * global object is the only way to exercise the shipped file itself rather than a copy
 * that can silently drift from it — the exact "second independent implementation" trap
 * this codebase explicitly tries to avoid elsewhere (see `src/lib/clerk-client-cookie.ts`
 * vs the bug `cookie-split.ts` reintroduced, and `src/app/api/push/send/route.ts`'s own
 * comment about its deliberately-duplicated concurrency cap).
 */
const SW_ORIGIN = "https://blackouttrades.com";

function loadServiceWorker(): Record<string, unknown> {
  const source = readFileSync(join(process.cwd(), "public/sw.js"), "utf8");
  const listeners: Record<string, (event: unknown) => unknown> = {};
  const sandbox: Record<string, unknown> = {
    caches: {
      open: async () => ({ addAll: async () => {}, put: async () => {} }),
      keys: async () => [],
      match: async () => undefined,
      delete: async () => true,
    },
    console,
    URL,
  };
  sandbox.self = {
    addEventListener: (type: string, cb: (event: unknown) => unknown) => {
      listeners[type] = cb;
    },
    location: { origin: SW_ORIGIN },
    skipWaiting: () => {},
    clients: {
      claim: async () => {},
      matchAll: async () => [],
      openWindow: async () => {},
    },
    registration: { showNotification: async () => {} },
    caches: sandbox.caches,
  };
  vm.createContext(sandbox);
  new vm.Script(source, { filename: "sw.js" }).runInContext(sandbox);
  return sandbox;
}

function resolveNotificationTarget(raw: unknown, origin: string, fallback: string): string {
  const sandbox = loadServiceWorker();
  const fn = sandbox.resolveNotificationTarget as
    | ((raw: unknown, origin: string, fallback: string) => string)
    | undefined;
  assert.equal(typeof fn, "function", "sw.js must define resolveNotificationTarget at top level");
  return fn!(raw, origin, fallback);
}

test("a same-origin absolute path resolves to itself", () => {
  const out = resolveNotificationTarget("/dashboard", SW_ORIGIN, "/dashboard");
  assert.equal(out, "/dashboard");
});

test("a same-origin path with query/hash is preserved", () => {
  const out = resolveNotificationTarget("/nighthawk?tab=plays#top", SW_ORIGIN, "/dashboard");
  assert.equal(out, "/nighthawk?tab=plays#top");
});

test("THE REGRESSION — a single leading backslash bypasses a naive startsWith('//') guard and must still be rejected", () => {
  // new URL("/\\evil.com/phish", "https://blackouttrades.com").origin === "https://evil.com"
  // even though "/\\evil.com/phish".startsWith("//") is false — the WHATWG parser treats
  // "\\" exactly like "/" for a special scheme, so this is a real cross-origin redirect.
  const raw = "/\\evil.com/phish";
  assert.equal(raw.startsWith("//"), false, "sanity: the old string guard would have let this through");
  const out = resolveNotificationTarget(raw, SW_ORIGIN, "/dashboard");
  assert.equal(out, "/dashboard");
});

test("a double backslash is also rejected", () => {
  const out = resolveNotificationTarget("/\\\\evil.com/phish", SW_ORIGIN, "/dashboard");
  assert.equal(out, "/dashboard");
});

test("an explicit protocol-relative URL is rejected (the case the old guard did catch)", () => {
  const out = resolveNotificationTarget("//evil.com/phish", SW_ORIGIN, "/dashboard");
  assert.equal(out, "/dashboard");
});

test("a fully-qualified cross-origin URL is rejected", () => {
  const out = resolveNotificationTarget("https://evil.com/phish", SW_ORIGIN, "/dashboard");
  assert.equal(out, "/dashboard");
});

test("a fully-qualified same-origin URL resolves to its path", () => {
  const out = resolveNotificationTarget("https://blackouttrades.com/vector", SW_ORIGIN, "/dashboard");
  assert.equal(out, "/vector");
});

test("a non-string or empty url falls back", () => {
  assert.equal(resolveNotificationTarget(undefined, SW_ORIGIN, "/dashboard"), "/dashboard");
  assert.equal(resolveNotificationTarget("", SW_ORIGIN, "/dashboard"), "/dashboard");
  assert.equal(resolveNotificationTarget(null, SW_ORIGIN, "/dashboard"), "/dashboard");
});

test("an unparseable string falls back rather than throwing", () => {
  assert.equal(resolveNotificationTarget("http://", SW_ORIGIN, "/dashboard"), "/dashboard");
});
