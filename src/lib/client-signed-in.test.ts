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
});
