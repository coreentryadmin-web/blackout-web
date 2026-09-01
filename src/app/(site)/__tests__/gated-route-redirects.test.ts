import { before, describe, test, mock } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

/**
 * Integration test for the P0 filed in #2836 ("page-level redirect() gates broken app-wide").
 *
 * That finding turned out to be a false positive (see docs/audit/findings-staging/
 * 2026-08-24-admin-page-authz-bypass.md — corrected). `redirect()` from "next/navigation" throws
 * an Error with a `NEXT_REDIRECT;...` digest regardless of whether it's called from a page.tsx or
 * a layout.tsx; Next's streaming SSR renders that as a real 307 when nothing has streamed yet, or
 * as a `<meta http-equiv="refresh">` + RSC digest when the 200 status is already committed —
 * either way, a real client always navigates away and the gated component's markup never enters
 * the response. The layout-level refactor in #2836 was unnecessary but harmless.
 *
 * What was actually missing — and what this file adds — is the integration test the finding's own
 * write-up called for: import the REAL layout module for each gated route family and, with a
 * mocked non-qualifying session, assert the exported function actually throws the redirect digest
 * to the right destination. A future change that swallows or short-circuits that throw (the
 * originally-suspected failure mode) would fail these tests even though it can't be seen by
 * unit-testing requireAdmin()/requireTier() in isolation, because those are exactly what's under
 * test here, invoked exactly as Next invokes them.
 */

const CSS_MOCKS = [
  path.join(process.cwd(), "src/app/styles/admin-console.css"),
  path.join(process.cwd(), "src/app/nighthawk-v2.css"),
  path.join(process.cwd(), "src/app/nighthawk-desk-theme.css"),
];
for (const cssPath of CSS_MOCKS) {
  mock.module(cssPath, { namedExports: {} });
}

// heatmap/meridian/nighthawk/terminal/vector layouts import ComingSoon for the
// tool-not-launched fallback. ComingSoon -> ProductMark -> geometry.tsx uses JSX without an
// explicit React import (relies on the automatic runtime), which the plain CJS transform this
// test runs under does not support ("React is not defined"). Stub it out — this test cares
// whether the gate throws the redirect before ComingSoon would ever render, not about the
// component's own JSX.
mock.module(path.join(process.cwd(), "src/components/ComingSoon.tsx"), {
  namedExports: { ComingSoon: () => null },
});

type FakeClerkUser = {
  id: string;
  publicMetadata: Record<string, unknown>;
  emailAddresses: { id: string; emailAddress: string }[];
  primaryEmailAddressId: string;
  firstName: string | null;
  lastName: string | null;
};

let mockUserId: string | null = "user_test_gate";
let mockSessionClaims: Record<string, unknown> | null = null;
let mockClerkUser: FakeClerkUser = {
  id: "user_test_gate",
  publicMetadata: { role: "member", tier: "free" },
  emailAddresses: [{ id: "email_1", emailAddress: "gate-test@example.com" }],
  primaryEmailAddressId: "email_1",
  firstName: null,
  lastName: null,
};

mock.module("@clerk/nextjs/server", {
  namedExports: {
    auth: async () => ({ userId: mockUserId, sessionClaims: mockSessionClaims }),
    clerkClient: async () => ({
      users: { getUser: async (_id: string) => mockClerkUser },
    }),
  },
});

function setSession(opts: {
  role?: "admin" | "member";
  tier?: "free" | "community" | "premium";
}) {
  mockSessionClaims = { role: opts.role ?? "member", tier: opts.tier ?? "free" };
  mockClerkUser = {
    ...mockClerkUser,
    publicMetadata: { role: opts.role ?? "member", tier: opts.tier ?? "free" },
  };
}

/** Assert `fn()` throws next/navigation's redirect digest, to the given destination. */
async function assertRedirectsTo(fn: () => Promise<unknown>, destination: string) {
  await assert.rejects(
    fn,
    (err: unknown) => {
      const digest = (err as { digest?: string } | undefined)?.digest;
      assert.ok(digest, `expected a NEXT_REDIRECT digest, got: ${String(err)}`);
      assert.match(digest, /^NEXT_REDIRECT;replace;/);
      assert.ok(
        digest.includes(`;${destination};`),
        `expected redirect to "${destination}", got digest: ${digest}`
      );
      return true;
    }
  );
}

describe("gated route layouts redirect non-qualifying sessions (integration, not just the predicate)", () => {
  let AdminLayout: typeof import("../admin/layout").default;
  let DashboardLayout: typeof import("../dashboard/layout").default;
  let FlowsLayout: typeof import("../flows/layout").default;
  let HeatmapLayout: typeof import("../heatmap/layout").default;
  let MeridianLayout: typeof import("../meridian/layout").default;
  let NighthawkLayout: typeof import("../nighthawk/layout").default;
  let TerminalLayout: typeof import("../terminal/layout").default;
  let VectorLayout: typeof import("../vector/layout").default;
  let EmbedTrackRecordLayout: typeof import("../../embed/track-record/layout").default;

  before(async () => {
    ({ default: AdminLayout } = await import("../admin/layout.tsx"));
    ({ default: DashboardLayout } = await import("../dashboard/layout.tsx"));
    ({ default: FlowsLayout } = await import("../flows/layout.tsx"));
    ({ default: HeatmapLayout } = await import("../heatmap/layout.tsx"));
    ({ default: MeridianLayout } = await import("../meridian/layout.tsx"));
    ({ default: NighthawkLayout } = await import("../nighthawk/layout.tsx"));
    ({ default: TerminalLayout } = await import("../terminal/layout.tsx"));
    ({ default: VectorLayout } = await import("../vector/layout.tsx"));
    ({ default: EmbedTrackRecordLayout } = await import("../../embed/track-record/layout.tsx"));
  });

  test("free-tier session hitting /dashboard (community) is redirected to /upgrade, not rendered", async () => {
    setSession({ tier: "free" });
    await assertRedirectsTo(
      () => DashboardLayout({ children: null }) as unknown as Promise<unknown>,
      "/upgrade"
    );
  });

  test("community-tier session hitting /flows (premium) is redirected to /upgrade, not rendered", async () => {
    setSession({ tier: "community" });
    await assertRedirectsTo(
      () => FlowsLayout({ children: null }) as unknown as Promise<unknown>,
      "/upgrade"
    );
  });

  test("free-tier session hitting /heatmap (premium desk tool) is redirected to /upgrade, not rendered", async () => {
    setSession({ tier: "free" });
    await assertRedirectsTo(
      () => HeatmapLayout({ children: null }) as unknown as Promise<unknown>,
      "/upgrade"
    );
  });

  test("free-tier session hitting /meridian (premium desk tool) is redirected to /upgrade, not rendered", async () => {
    setSession({ tier: "free" });
    await assertRedirectsTo(
      () => MeridianLayout({ children: null }) as unknown as Promise<unknown>,
      "/upgrade"
    );
  });

  test("free-tier session hitting /nighthawk (premium desk tool) is redirected to /upgrade, not rendered", async () => {
    setSession({ tier: "free" });
    await assertRedirectsTo(
      () => NighthawkLayout({ children: null }) as unknown as Promise<unknown>,
      "/upgrade"
    );
  });

  test("free-tier session hitting /terminal (premium desk tool) is redirected to /upgrade, not rendered", async () => {
    setSession({ tier: "free" });
    await assertRedirectsTo(
      () => TerminalLayout({ children: null }) as unknown as Promise<unknown>,
      "/upgrade"
    );
  });

  test("free-tier session hitting /vector (premium desk tool) is redirected to /upgrade, not rendered", async () => {
    setSession({ tier: "free" });
    await assertRedirectsTo(
      () => VectorLayout({ children: null }) as unknown as Promise<unknown>,
      "/upgrade"
    );
  });

  test("non-admin member session hitting /admin is redirected to /dashboard, not rendered", async () => {
    setSession({ role: "member", tier: "free" });
    await assertRedirectsTo(
      () => AdminLayout({ children: null }) as unknown as Promise<unknown>,
      "/dashboard"
    );
  });

  test("non-admin PREMIUM member session hitting /admin is still redirected — admin gate is role-based, not tier-based", async () => {
    setSession({ role: "member", tier: "premium" });
    await assertRedirectsTo(
      () => AdminLayout({ children: null }) as unknown as Promise<unknown>,
      "/dashboard"
    );
  });

  test("non-admin member session hitting /embed/track-record is redirected to /dashboard, not rendered", async () => {
    setSession({ role: "member", tier: "free" });
    await assertRedirectsTo(
      () => EmbedTrackRecordLayout({ children: null }) as unknown as Promise<unknown>,
      "/dashboard"
    );
  });

  test("premium session passes the /flows tier gate (JWT fast path — no redirect thrown)", async () => {
    setSession({ tier: "premium" });
    const result = await FlowsLayout({ children: "ok" as unknown as React.ReactNode });
    assert.equal(result, "ok");
  });

  test("admin session passes the /admin role gate (JWT fast path — no redirect thrown)", async () => {
    setSession({ role: "admin", tier: "free" });
    const result = await AdminLayout({ children: "ok" as unknown as React.ReactNode });
    assert.equal(result, "ok");
  });
});
