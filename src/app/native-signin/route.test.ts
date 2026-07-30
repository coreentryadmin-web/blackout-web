import { before, describe, test, mock } from "node:test";
import assert from "node:assert/strict";

let mockUserId: string | null = null;
let mockSessionCookie: string | null = null;

mock.module("../../lib/clerk-session-cookies", {
  namedExports: {
    activeClerkUserIdFromRequestCookies: async () => mockUserId,
  },
});

mock.module("next/headers", {
  namedExports: {
    cookies: async () => ({
      get: (name: string) =>
        name === "__session" && mockSessionCookie
          ? { name, value: mockSessionCookie }
          : undefined,
      getAll: () =>
        mockSessionCookie ? [{ name: "__session", value: mockSessionCookie }] : [],
    }),
  },
});

describe("GET /native-signin", () => {
  let GET: typeof import("./route").GET;

  before(async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://blackouttrades.com";
    ({ GET } = await import("./route"));
  });

  test("redirects unauthenticated users to public sign-in, not 0.0.0.0", async () => {
    mockUserId = null;
    mockSessionCookie = null;

    const req = new Request("http://0.0.0.0/native-signin");
    const res = await GET(req as import("next/server").NextRequest);

    assert.equal(res.status, 302);
    const location = res.headers.get("location");
    assert.ok(location);
    assert.match(location!, /^https:\/\/blackouttrades\.com\/sign-in/);
    assert.doesNotMatch(location!, /0\.0\.0\.0/);
    assert.match(location!, /redirect_url=%2Fnative-signin|redirect_url=\/native-signin/);
  });

  test("returns token handoff HTML when session cookie is present", async () => {
    mockUserId = "user_abc";
    mockSessionCookie = "sess_jwt_token";

    const req = new Request("http://0.0.0.0/native-signin");
    const res = await GET(req as import("next/server").NextRequest);
    const html = await res.text();

    assert.equal(res.status, 200);
    assert.match(html, /blackout-trades:\/\/auth\?token=/);
    assert.match(html, /sess_jwt_token/);
  });
});
