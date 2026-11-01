import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getIosHeaderMeta,
  getIosRouteKey,
  getIosToolMeta,
  getIosToolNavLabel,
  getIosToolRouteIndex,
  isIosNativeShellPath,
  isIosNativeShellRoute,
  isIosToolRoute,
  IOS_TOOLS,
} from "@/lib/ios-tool-routes";

// `IOS_TOOL_NAV_LABELS` was the real lookup table `getIosToolNavLabel` used, back when the
// function was `IOS_TOOL_NAV_LABELS[match]` (introduced #556). #557's "native product shell"
// rewrite replaced that body with `getIosToolMeta(path)?.label` (richer per-tool metadata:
// mark/accent/tagline/code) but kept re-deriving `IOS_TOOL_NAV_LABELS` from `IOS_TOOLS` anyway —
// orphaning it with zero consumers (repo-wide grep and `git log --all -S` both confirm it's only
// ever touched by the two commits that defined/redefined it, never referenced from a third).
// Pin the module's export surface so an orphaned, no-longer-consumed convenience constant can't
// silently drift back in unnoticed, the same discipline #7062/#7139 used for their own dead
// re-derivations of already-covered data.
describe("ios-tool-routes.ts export surface", () => {
  it("no longer exports the orphaned IOS_TOOL_NAV_LABELS re-derivation", () => {
    const source = readFileSync(join(__dirname, "ios-tool-routes.ts"), "utf8");
    const exportNames = [
      ...source.matchAll(/^export\s+(?:type\s+)?(?:async\s+)?(?:function|const)\s+([A-Za-z0-9_]+)/gm),
    ].map((m) => m[1]);
    assert.ok(!exportNames.includes("IOS_TOOL_NAV_LABELS"), "IOS_TOOL_NAV_LABELS should be removed");
    assert.deepEqual(
      exportNames.sort(),
      [
        "IOS_NATIVE_SHELL_PATH_PREFIXES",
        "IOS_TOOLS",
        "IOS_TOOL_ROUTES",
        "getIosHeaderMeta",
        "getIosRouteKey",
        "getIosToolMeta",
        "getIosToolNavLabel",
        "getIosToolRouteIndex",
        "isIosNativeShellPath",
        "isIosNativeShellRoute",
        "isIosToolRoute",
      ].sort(),
    );
  });
});

describe("isIosToolRoute", () => {
  it("matches primary tool paths", () => {
    assert.equal(isIosToolRoute("/dashboard"), true);
    assert.equal(isIosToolRoute("/flows"), true);
    assert.equal(isIosToolRoute("/heatmap"), true);
    assert.equal(isIosToolRoute("/terminal"), true);
    assert.equal(isIosToolRoute("/nighthawk/edition"), true);
    assert.equal(isIosToolRoute("/vector"), true);
    assert.equal(isIosToolRoute("/meridian"), true);
    assert.equal(isIosToolRoute("/vector?ticker=SPY"), true);
  });

  it("rejects marketing and auth paths", () => {
    assert.equal(isIosToolRoute("/"), false);
    assert.equal(isIosToolRoute("/pricing"), false);
    assert.equal(isIosToolRoute("/sign-in"), false);
    assert.equal(isIosToolRoute("/faq"), false);
  });

  it("resolves nav labels for tool routes", () => {
    assert.equal(getIosToolNavLabel("/dashboard"), "SPX Slayer");
    assert.equal(getIosToolNavLabel("/flows"), "HELIX");
    assert.equal(getIosToolNavLabel("/nighthawk/edition"), "Night Hawk");
    assert.equal(getIosToolNavLabel("/account"), null);
  });
});

describe("isIosNativeShellRoute", () => {
  it("includes tool routes and signed-in utility paths", () => {
    assert.equal(isIosNativeShellRoute("/dashboard"), true);
    assert.equal(isIosNativeShellRoute("/account"), true);
    assert.equal(isIosNativeShellRoute("/upgrade"), true);
    assert.equal(isIosNativeShellRoute("/admin/health"), true);
  });

  it("excludes marketing and auth paths", () => {
    assert.equal(isIosNativeShellRoute("/"), false);
    assert.equal(isIosNativeShellRoute("/sign-in"), false);
    assert.equal(isIosNativeShellRoute("/pricing"), false);
  });

  // isIosToolRoute (the tool half of isIosNativeShellRoute, see above) already strips a
  // query/hash suffix via normalizeIosPath before matching — isIosNativeShellPath (the utility
  // half: /account, /faq, /learn, /upgrade, /admin) did not, so a signed-in utility path with a
  // query string or hash (e.g. a deep link, a redirect carrying `?from=`, or an in-page `#anchor`)
  // fell through both the exact-match and the startsWith(`${prefix}/`) check and incorrectly
  // read as NOT a native-shell route. Both real call sites (useIosNativeShell/IosAppChrome) feed
  // this from Next's usePathname(), which never carries a query/hash, so this was unreachable in
  // practice — but the function should still be correct standing alone, and the inconsistency
  // with its sibling isIosToolRoute (which already handles this) was the bug.
  it("strips a query string or hash before matching utility paths", () => {
    assert.equal(isIosNativeShellPath("/account?from=upgrade"), true);
    assert.equal(isIosNativeShellPath("/upgrade#plans"), true);
    assert.equal(isIosNativeShellPath("/admin/health?tab=cron"), true);
    assert.equal(isIosNativeShellRoute("/account?from=upgrade"), true);
    assert.equal(isIosNativeShellRoute("/faq#billing"), true);
    // Still correctly rejects a non-native-shell path carrying a query/hash.
    assert.equal(isIosNativeShellPath("/pricing?ref=home"), false);
    assert.equal(isIosNativeShellRoute("/sign-in?redirect=/account"), false);
  });
});

describe("IOS_TOOLS metadata", () => {
  it("defines seven primary tools with accents and instrument codes", () => {
    assert.equal(IOS_TOOLS.length, 7);
    assert.ok(IOS_TOOLS.every((t) => t.accent.startsWith("#")));
    assert.ok(IOS_TOOLS.every((t) => t.code.length >= 2 && t.code.length <= 4));
    assert.deepEqual(
      IOS_TOOLS.map((t) => t.code),
      ["SPX", "HLX", "THM", "LRG", "HWK", "VEC", "MRD"]
    );
  });

  it("resolves tool meta by path prefix", () => {
    assert.equal(getIosToolMeta("/flows")?.label, "HELIX");
    assert.equal(getIosToolMeta("/nighthawk/edition")?.short, "Hawk");
    assert.equal(getIosToolMeta("/pricing"), null);
  });

  it("returns tab order index for transitions", () => {
    assert.equal(getIosToolRouteIndex("/dashboard"), 0);
    assert.equal(getIosToolRouteIndex("/flows"), 1);
    assert.equal(getIosToolRouteIndex("/nighthawk"), 4);
    assert.equal(getIosToolRouteIndex("/vector"), 5);
    assert.equal(getIosToolRouteIndex("/meridian"), 6);
    assert.equal(getIosToolRouteIndex("/account"), -1);
  });
});

describe("getIosRouteKey", () => {
  it("maps tool and utility paths to route keys", () => {
    assert.equal(getIosRouteKey("/dashboard"), "dashboard");
    assert.equal(getIosRouteKey("/terminal"), "largo");
    assert.equal(getIosRouteKey("/meridian"), "meridian");
    assert.equal(getIosRouteKey("/faq"), "faq");
    assert.equal(getIosRouteKey("/learn/spx-slayer"), "learn");
    assert.equal(getIosRouteKey("/admin/health"), "admin");
  });

  // Same bug class, same sibling file, as the isIosNativeShellPath query/hash fix above:
  // getIosRouteKey's "/dashboard" branch is the one check in this function that requires an
  // EXACT match or a startsWith(`${prefix}/`) match (every other branch here is a bare
  // startsWith, which already tolerates a query/hash suffix appended directly after the
  // prefix). A query string or hash on "/dashboard" itself ("/dashboard?ref=upgrade",
  // "/dashboard#widgets") fails both of those checks and falls through every other branch to
  // "other" instead of "dashboard" — the exact-match requirement is what makes this branch,
  // alone among the ones here, sensitive to an un-stripped suffix.
  it("strips a query string or hash before matching the exact-match /dashboard branch", () => {
    assert.equal(getIosRouteKey("/dashboard?ref=upgrade"), "dashboard");
    assert.equal(getIosRouteKey("/dashboard#widgets"), "dashboard");
    assert.equal(getIosRouteKey("/dashboard/positions?tab=open"), "dashboard");
  });
});

describe("getIosHeaderMeta", () => {
  it("returns tagline kickers for tools", () => {
    assert.equal(getIosHeaderMeta("/flows").kicker, "Institutional flow tape");
    assert.equal(getIosHeaderMeta("/flows").title, "Intelligence");
    assert.equal(getIosHeaderMeta("/flows").showBack, false);
    assert.equal(getIosHeaderMeta("/heatmap").title, "Intelligence");
  });

  it("returns Vector as a first-class tool with no back button", () => {
    const vector = getIosHeaderMeta("/vector");
    assert.equal(vector.title, "Vector");
    assert.equal(vector.kicker, "Gamma-wall radar · cross-ticker");
    assert.equal(vector.showBack, false);
  });

  it("returns Meridian as a first-class tool with no back button", () => {
    const meridian = getIosHeaderMeta("/meridian");
    assert.equal(meridian.title, "Meridian");
    assert.equal(meridian.kicker, "Catalyst structure desk");
    assert.equal(meridian.showBack, false);
  });

  it("returns utility titles with back affordance", () => {
    const account = getIosHeaderMeta("/account");
    assert.equal(account.title, "Account");
    assert.equal(account.kicker, "");
    assert.equal(account.showBack, true);
    assert.equal(getIosHeaderMeta("/learn").title, "Learn");
  });
});
