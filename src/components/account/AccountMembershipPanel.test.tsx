import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
(globalThis as unknown as { React: typeof React }).React = React;

import { resolveMembershipPanelView } from "./AccountMembershipPanel";

test("resolveMembershipPanelView returns tier:null while Clerk is still loading, regardless of rawTier", () => {
  // The bug: useAppAuth().tier defaults to null before Clerk loads, and
  // resolveDisplayTier(null) resolves that to "free" — so reading tier
  // without checking isLoaded first produces "free" even for a member who
  // will turn out to be premium once loading completes.
  assert.deepEqual(resolveMembershipPanelView(null, false), { tier: null });
  assert.deepEqual(resolveMembershipPanelView("premium", false), { tier: null });
});

test("resolveMembershipPanelView resolves the real tier once loaded", () => {
  assert.deepEqual(resolveMembershipPanelView(null, true), { tier: "free" });
  assert.deepEqual(resolveMembershipPanelView("premium", true), { tier: "premium" });
  assert.deepEqual(resolveMembershipPanelView("community", true), { tier: "community" });
  // admin's synthetic rawTier displays as premium (resolveDisplayTier's own contract).
  assert.deepEqual(resolveMembershipPanelView("admin", true), { tier: "premium" });
});

test("AccountMembershipPanel does not render the free-tier Upgrade CTA while auth is still loading", async () => {
  const { AccountMembershipPanel } = await import("./AccountMembershipPanel");

  // No ClerkAuthBridge wrapper → useAppAuth() falls back to its unloaded
  // default (isLoaded: false, tier: null), exactly reproducing a real
  // first-paint before Clerk resolves.
  const html = renderToStaticMarkup(React.createElement(AccountMembershipPanel));

  assert.match(html, /Loading…/, "must show the loading label while unresolved");
  assert.doesNotMatch(
    html,
    /href="\/upgrade"/,
    "must not flash the free-tier Upgrade CTA before the real tier is known"
  );
  assert.doesNotMatch(
    html,
    /Manage subscription/,
    "must not flash the paid-tier Manage CTA before the real tier is known"
  );
});
