import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { signedInFromCookieStore } from "./clerk-session-cookies";

function jar(entries: Record<string, string>) {
  return {
    get: (name: string) => {
      const value = entries[name];
      return value !== undefined ? { name, value } : undefined;
    },
    getAll: () => Object.entries(entries).map(([name, value]) => ({ name, value })),
  };
}

describe("signedInFromCookieStore", () => {
  test("true when __client_uat is nonzero", () => {
    assert.equal(signedInFromCookieStore(jar({ __client_uat: "1700000000" }) as never), true);
  });

  test("false when only __client_uat=0", () => {
    assert.equal(signedInFromCookieStore(jar({ __client_uat: "0" }) as never), false);
  });

  test("false when no cookies", () => {
    assert.equal(signedInFromCookieStore(jar({}) as never), false);
  });
});
