import assert from "node:assert/strict";
import { test, mock } from "node:test";

// Regression: a wrong-side gamma wall (call wall below spot, or put wall above spot) must
// degrade to an honest "concentration" label with the real number still shown — never be
// silently hidden (`call_wall`/`put_wall: null`). `classifyWall`/`correctPublicRead`
// (public-gex-snapshot-types.ts) exist specifically for this, documented with a real production
// measurement (2026-08-12: SPX spot 7748.5, put wall 8000 — "the NUMBER is right. Calling it
// 'support' is what's wrong."). A later client-side "defensive constraint" patch (#2832) nulled
// any wall landing on the wrong side of spot BEFORE it ever reached `classifyWall`, which:
//   (a) hid the wall's number entirely instead of honestly labelling it, re-introducing the
//       exact "the wall vanishes" failure mode #2128 ("honest wall labels") existed to avoid, and
//   (b) made the "concentration" branch of `classifyWall`/`correctPublicRead` unreachable
//       through this builder — their own tests only ever exercised `classifyWall` in isolation.
// `heatmap.gex.call_wall`/`put_wall` are already side-constrained at the SOURCE for a
// freshly-built matrix (`wallsFromStrikeTotals(strikeTotals, spot)`), so this fixture models the
// one case that still matters: a stale/cached or future-regressed heatmap carrying an inverted
// wall — exactly the scenario the doc comments on `classifyWall`/`correctPublicRead` describe.
const state = {
  cache: new Map<string, unknown>(),
  heatmap: {
    spot: 7748.5,
    change_pct: 0.1,
    asof: "2026-08-12T19:00:00.000Z",
    gex: {
      // Below spot — cannot honestly be called "resistance".
      call_wall: 7490,
      put_wall: null as number | null,
      flip: 7700,
      regime: {
        posture: "long" as const,
        read: "Spot 7,748.50 is above the gamma flip (7,700.00) → long gamma: range-bound, fade extremes. Resistance 7,490.",
      },
    },
  },
};

mock.module("./shared-cache", {
  namedExports: {
    sharedCacheGet: async (key: string) => (state.cache.has(key) ? state.cache.get(key) : null),
    sharedCacheSet: async (key: string, value: unknown) => {
      state.cache.set(key, value);
    },
    sharedCacheDel: async (key: string) => {
      state.cache.delete(key);
    },
  },
});

mock.module("./providers/polygon-options-gex", {
  namedExports: {
    fetchGexHeatmap: async () => state.heatmap,
  },
});

test("a call wall below spot degrades to concentration WITH the number shown, not a hidden null", async () => {
  const { buildPublicGexSnapshot } = await import("./public-gex-snapshot.ts");
  state.cache.clear();

  const snapshot = await buildPublicGexSnapshot("SPX");

  // The number must survive — hiding it is the exact regression this guards against.
  assert.equal(snapshot.call_wall, 7490, "the real wall number must still be served");
  assert.equal(snapshot.call_wall_role, "concentration");
  // The read must stop asserting "Resistance 7,490." (a level on the wrong side of spot) but
  // must not fabricate a claim about a put wall that was never present.
  assert.ok(
    !snapshot.read.includes("Resistance 7,490"),
    `read must not keep asserting the wrong-side level verbatim: ${snapshot.read}`
  );
  assert.match(snapshot.read, /isn't acting as a level/);
});

test("put_wall stays null (never fabricated) when the source has no put wall at all", async () => {
  const { buildPublicGexSnapshot } = await import("./public-gex-snapshot.ts");
  state.cache.clear();

  const snapshot = await buildPublicGexSnapshot("SPX");

  assert.equal(snapshot.put_wall, null);
  assert.equal(snapshot.put_wall_role, null);
});
