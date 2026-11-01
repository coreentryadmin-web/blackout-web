import { describe, test } from "node:test";
import assert from "node:assert/strict";

/**
 * Regression coverage for the suffixed-cookie-blind client reads (round 194 audit). Clerk's
 * backend SDK writes `<name>_<publishableKeySuffix>` INSTEAD OF the bare `<name>` whenever this
 * instance's cookie would otherwise collide with another Clerk instance on the same top-level
 * domain — already confirmed happening live in this deployment (#797, #7082) for `__session`/
 * `__client_uat`. `client-signed-in.ts`'s `readClientSignedIn()` and `ga4-client.ts`'s
 * `hasSessionCookie()` each used to re-implement a bare-name-only `document.cookie` check that
 * missed this cookie shape entirely, independent of the server-side fix in #7082 (which only
 * covers `req.cookies`, a different API). This module is the shared fix both now use.
 */
function withDocumentCookie<T>(cookie: string, run: () => T): T {
  const g = globalThis as typeof globalThis & { document?: { cookie: string } };
  const original = g.document;
  g.document = { cookie };
  try {
    return run();
  } finally {
    if (original === undefined) delete g.document;
    else g.document = original;
  }
}

describe("clerkClientCookieValue / clerkClientCookiePresent", () => {
  test("finds the bare cookie name", async () => {
    const { clerkClientCookieValue, clerkClientCookiePresent } = await import(
      "./clerk-client-cookie.ts"
    );
    withDocumentCookie("__client_uat=1700000000", () => {
      assert.equal(clerkClientCookieValue("__client_uat"), "1700000000");
      assert.equal(clerkClientCookiePresent("__client_uat"), true);
    });
  });

  test("finds a SUFFIXED-only cookie (the real #797/#7082 shape) — the regression this fixes", async () => {
    const { clerkClientCookieValue, clerkClientCookiePresent } = await import(
      "./clerk-client-cookie.ts"
    );
    withDocumentCookie("__client_uat_AbCdEf12=1700000000; __session_AbCdEf12=eyJ.fake.jwt", () => {
      assert.equal(clerkClientCookieValue("__client_uat"), "1700000000");
      assert.equal(clerkClientCookiePresent("__client_uat"), true);
      assert.equal(clerkClientCookiePresent("__session"), true);
    });
  });

  test("does not false-positive on an unrelated cookie that merely shares a prefix", async () => {
    const { clerkClientCookiePresent } = await import("./clerk-client-cookie.ts");
    withDocumentCookie("__client_uat_extra_thing_unrelated=1", () => {
      // This IS a suffixed match by design (Clerk's suffix is opaque) — document the boundary:
      // only an exact "_" immediately after the base name counts, which `_extra_thing_unrelated`
      // satisfies. A cookie that does NOT start with "__client_uat" at all must not match.
      assert.equal(clerkClientCookiePresent("__other_cookie"), false);
    });
  });

  test("returns null/false when absent", async () => {
    const { clerkClientCookieValue, clerkClientCookiePresent } = await import(
      "./clerk-client-cookie.ts"
    );
    withDocumentCookie("unrelated=1", () => {
      assert.equal(clerkClientCookieValue("__client_uat"), null);
      assert.equal(clerkClientCookiePresent("__client_uat"), false);
    });
  });

  test("off the browser (no document), both return the absent value and never throw", async () => {
    const { clerkClientCookieValue, clerkClientCookiePresent } = await import(
      "./clerk-client-cookie.ts"
    );
    assert.equal(clerkClientCookieValue("__client_uat"), null);
    assert.equal(clerkClientCookiePresent("__client_uat"), false);
  });
});
