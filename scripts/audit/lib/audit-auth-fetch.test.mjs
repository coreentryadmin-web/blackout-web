/**
 * Regression test for audit-auth-fetch.mjs's cron-bearer branch.
 *
 * ROOT CAUSE: `fetchAuditJsonOnce`'s `r.ok` branch called `await r.json()` with no guard, while
 * the sibling non-ok branch three lines below it guarded the identical call with
 * `.catch(() => ({}))`. A 200 response whose body is not valid JSON (an HTML error page served
 * by a mismatched/typo'd route, a Cloudflare interstitial, an empty 204-shaped body) threw a
 * SyntaxError that nothing in the call chain caught — `fetchAuditJson`'s retry loop has no
 * try/catch around `fetchAuditJsonOnce()` — so the exception propagated out of the exported
 * `fetchAuditJson` and crashed the whole unattended audit script, instead of falling through to
 * the Clerk member-path fallback this module exists to provide.
 *
 * Run: node --experimental-test-module-mocks --test scripts/audit/lib/audit-auth-fetch.test.mjs
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("./prod-secrets.mjs", {
  namedExports: {
    auditSecret: (key) => (key === "CRON_SECRET" ? "test-cron-secret" : ""),
  },
});

let clerkMintCalls = 0;
mock.module("./prod-clerk-session.mjs", {
  namedExports: {
    mintClerkPremiumSession: async () => {
      clerkMintCalls++;
      return {
        skip: false,
        cookieHeader: "__session=clerk-jwt; __client_uat=1",
        cleanup: async () => {},
      };
    },
  },
});

const { fetchAuditJson, releaseAuditClerkSession } = await import("./audit-auth-fetch.mjs");

/** Module-level Clerk session cache must not leak state between test cases. */
async function freshClerkCache() {
  await releaseAuditClerkSession();
  clerkMintCalls = 0;
}

/** Deterministically control whether the Clerk fallback path is reachable, restoring after. */
function withClerkKeysUnset(fn) {
  return async () => {
    const savedSecret = process.env.CLERK_SECRET_KEY;
    const savedPub = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    delete process.env.CLERK_SECRET_KEY;
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    try {
      await fn();
    } finally {
      if (savedSecret !== undefined) process.env.CLERK_SECRET_KEY = savedSecret;
      if (savedPub !== undefined) process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = savedPub;
    }
  };
}

function withClerkKeysSet(fn) {
  return async () => {
    const savedSecret = process.env.CLERK_SECRET_KEY;
    const savedPub = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    process.env.CLERK_SECRET_KEY = "sk_test_dummy";
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_dummy";
    try {
      await fn();
    } finally {
      if (savedSecret === undefined) delete process.env.CLERK_SECRET_KEY;
      else process.env.CLERK_SECRET_KEY = savedSecret;
      if (savedPub === undefined) delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
      else process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = savedPub;
    }
  };
}

test(
  "a 200 cron response with an unparseable body does not throw, and is never reported ok:true",
  withClerkKeysUnset(async () => {
    await freshClerkCache();
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        async json() {
          throw new SyntaxError("Unexpected end of JSON input");
        },
      });

      // Must not throw — this is the exact crash this test guards against. With no Clerk
      // fallback reachable (keys unset above), the honest outcome is a graceful ok:false.
      const result = await fetchAuditJson("https://example.test", "/api/whatever");
      assert.equal(typeof result, "object");
      assert.equal(result.ok, false, "an unparseable 200 must never be reported as ok:true");
    } finally {
      globalThis.fetch = originalFetch;
    }
  })
);

test(
  "falls through to the Clerk member-path when the cron response's body is unparseable",
  withClerkKeysSet(async () => {
    await freshClerkCache();
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async (_url, opts) => {
        const auth = opts?.headers?.Authorization;
        if (auth?.startsWith("Bearer ")) {
          // The cron-bearer call: 200 status, but a body that isn't JSON.
          return {
            ok: true,
            status: 200,
            async json() {
              throw new SyntaxError("Unexpected end of JSON input");
            },
          };
        }
        // The Clerk-cookie fallback call: a normal, well-formed JSON success.
        return {
          ok: true,
          status: 200,
          async json() {
            return { via: "clerk-fallback-worked" };
          },
        };
      };

      const result = await fetchAuditJson("https://example.test", "/api/whatever");
      assert.equal(result.ok, true);
      assert.equal(result.via, "clerk");
      assert.deepEqual(result.json, { via: "clerk-fallback-worked" });
      assert.equal(clerkMintCalls, 1, "must have minted exactly one Clerk session to fall through");
    } finally {
      globalThis.fetch = originalFetch;
      await freshClerkCache();
    }
  })
);

test(
  "a 200 cron response with a valid JSON body still returns ok:true via cron (no regression)",
  withClerkKeysUnset(async () => {
    await freshClerkCache();
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        async json() {
          return { hello: "world" };
        },
      });

      const result = await fetchAuditJson("https://example.test", "/api/whatever");
      assert.equal(result.ok, true);
      assert.equal(result.via, "cron");
      assert.deepEqual(result.json, { hello: "world" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  })
);
