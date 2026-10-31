import { describe, test } from "node:test";
import assert from "node:assert/strict";

describe("client-signed-in", () => {
  test("resolveClientSignedIn prefers cookie over stale server false", async () => {
    const g = globalThis as typeof globalThis & { document?: { cookie: string } };
    g.document = { cookie: "__client_uat=1700000000" };

    const { resolveClientSignedIn, readClientSignedIn } = await import("./client-signed-in");
    assert.equal(readClientSignedIn(), true);
    assert.equal(resolveClientSignedIn(false), true);

    delete g.document;
  });

  test("resolveClientSignedIn falls back to server when cookie absent", async () => {
    const g = globalThis as typeof globalThis & { document?: { cookie: string } };
    g.document = { cookie: "" };

    const { resolveClientSignedIn } = await import("./client-signed-in");
    assert.equal(resolveClientSignedIn(true), true);
    assert.equal(resolveClientSignedIn(false), false);

    delete g.document;
  });

  test("readClientSignedIn treats zero as signed out", async () => {
    const g = globalThis as typeof globalThis & { document?: { cookie: string } };
    g.document = { cookie: "__client_uat=0" };

    const { readClientSignedIn } = await import("./client-signed-in");
    assert.equal(readClientSignedIn(), false);

    delete g.document;
  });

  // Regression (round 194): Clerk suffixes __client_uat (in lockstep with __session) when this
  // instance's cookie would otherwise collide with another Clerk instance on the same top-level
  // domain — confirmed actually happening live in this deployment (#797, #7082). Before this fix,
  // readClientSignedIn's bare-name regex always returned null for a suffixed-only session, so
  // Nav.tsx's cookie self-heal and useMarketingSignedIn's post-hydration upgrade never fired for
  // a genuinely signed-in member carrying only the suffixed cookie.
  test("readClientSignedIn detects a SUFFIXED-only __client_uat cookie (real #797/#7082 scenario)", async () => {
    const g = globalThis as typeof globalThis & { document?: { cookie: string } };
    g.document = { cookie: "__client_uat_AbCdEf12=1700000000" };

    const { readClientSignedIn, resolveClientSignedIn } = await import("./client-signed-in");
    assert.equal(readClientSignedIn(), true);
    assert.equal(resolveClientSignedIn(false), true);

    delete g.document;
  });
});
