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

  // #797's exact failure mode, on the __client_uat side: Clerk suffixes BOTH __session and
  // __client_uat together (never one without the other) when this instance's cookie name
  // collides with another Clerk instance on the same top-level domain. The __session side of
  // this is already suffix-aware (activeClerkUserIdFromCookieStore). A request whose only
  // Clerk cookies are the suffixed __session_<suffix> (undecodable here with a fake JWT) and
  // __client_uat_<suffix> must still read as signed-in, matching requestHasClerkSessionCookie's
  // (clerk-session-recovery.ts) existing suffix-aware behavior for the identical cookie pair.
  test("true when only suffixed __client_uat_<suffix> is present", () => {
    assert.equal(
      signedInFromCookieStore(jar({ __client_uat_a1b2: "1700000000" }) as never),
      true
    );
  });

  test("false when only suffixed __client_uat_<suffix>=0 is present", () => {
    assert.equal(
      signedInFromCookieStore(jar({ __client_uat_a1b2: "0" }) as never),
      false
    );
  });
});
