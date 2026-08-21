import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  signatureSimilarity,
  underexposedSurfaces,
  visualNoveltyPenalty,
  type XIntelViewSignature,
  type XIntelVisualMemoryEntry,
} from "@/lib/x-intel/visual-memory";
import {
  eligibleFranchises,
  franchiseRepeatPenalty,
  franchiseWordmark,
  X_INTEL_FRANCHISES,
  type XIntelFranchise,
} from "@/lib/x-intel/franchises";
import { X_INTEL_VIEW_BY_ID, X_INTEL_VIEW_CATALOG } from "@/lib/x-intel/view-catalog";
import { checkCaptureUrl } from "@/lib/x-intel/capture-guard";

function sig(over: Partial<XIntelViewSignature> = {}): XIntelViewSignature {
  return {
    view_id: "thermal.matrix",
    surface: "thermal",
    page: "/heatmap",
    panel: "gex matrix",
    visualization: "matrix",
    ticker: "SPX",
    timeframe: "0dte",
    filters: { lens: "GEX" },
    composition: "flip band",
    ...over,
  };
}

const mem = (s: XIntelViewSignature, cycle = "c"): XIntelVisualMemoryEntry => ({
  signature: s,
  cycle_key: cycle,
});

describe("signatureSimilarity", () => {
  it("scores an identical frame at 1", () => {
    assert.equal(signatureSimilarity(sig(), sig()), 1);
  });

  it("scores two different visualizations on the same surface well below identical", () => {
    const a = sig();
    const b = sig({ view_id: "thermal.profile", panel: "gamma profile", visualization: "profile" });
    assert.ok(signatureSimilarity(a, b) < 0.6, "Matrix and Profile are visibly different pictures");
  });

  it("still scores the same view on a different ticker as substantially similar", () => {
    // Two Matrix shots of different tickers are the same picture with different numbers in it —
    // which is exactly the monotony the memory exists to catch.
    const s = signatureSimilarity(sig(), sig({ ticker: "NVDA" }));
    assert.ok(s > 0.6, `expected high similarity, got ${s}`);
  });

  it("separates frames that differ only by filter state", () => {
    assert.ok(signatureSimilarity(sig(), sig({ filters: { lens: "VEX" } })) < 1);
  });

  it("is symmetric", () => {
    const a = sig();
    const b = sig({ ticker: "NVDA", timeframe: "15m" });
    assert.equal(signatureSimilarity(a, b), signatureSimilarity(b, a));
  });
});

describe("visualNoveltyPenalty", () => {
  it("does not penalise a frame with no history", () => {
    assert.equal(visualNoveltyPenalty(sig(), []), 1);
  });

  it("penalises an identical frame used in the last package hardest", () => {
    const p = visualNoveltyPenalty(sig(), [mem(sig())]);
    assert.ok(p < 0.3, `expected a heavy penalty, got ${p}`);
  });

  it("NEVER returns zero — an identical frame stays selectable as overwhelming evidence", () => {
    // A ban would force a post whose attachment does not support its claim, which is worse than
    // repetition. This is the property that makes it a penalty rather than a filter.
    assert.ok(visualNoveltyPenalty(sig(), [mem(sig())]) > 0);
  });

  it("penalises less as the repeat recedes into history", () => {
    const recent = mem(sig());
    const filler = Array.from({ length: 5 }, (_, i) =>
      mem(sig({ view_id: `other.${i}`, surface: `s${i}`, visualization: `v${i}`, ticker: `T${i}` })),
    );
    const near = visualNoveltyPenalty(sig(), [recent, ...filler]);
    const far = visualNoveltyPenalty(sig(), [...filler, recent]);
    assert.ok(far > near, `stale repeat should be cheaper: near=${near} far=${far}`);
  });

  it("does not let one repeated view hide behind a crowd of novel ones", () => {
    // The WORST match decides, not the average — averaging is how a lazily reused panel survives.
    const novel = Array.from({ length: 10 }, (_, i) =>
      mem(sig({ view_id: `other.${i}`, surface: `s${i}`, visualization: `v${i}`, ticker: `T${i}` })),
    );
    assert.ok(visualNoveltyPenalty(sig(), [mem(sig()), ...novel]) < 0.3);
  });

  it("leaves a genuinely different frame on the same surface nearly unpenalised", () => {
    const p = visualNoveltyPenalty(
      sig({ view_id: "thermal.shift", panel: "shift", visualization: "shift", ticker: "NVDA" }),
      [mem(sig())],
    );
    assert.ok(p > 0.7, `expected a light penalty, got ${p}`);
  });
});

describe("underexposedSurfaces", () => {
  const ALL = ["helix", "thermal", "vector", "nighthawk", "meridian", "largo", "spx_slayer"];

  it("puts never-used surfaces ahead of recently-used ones", () => {
    const recent = [mem(sig({ surface: "helix" })), mem(sig({ surface: "thermal" }))];
    const order = underexposedSurfaces(ALL, recent);
    assert.ok(order.indexOf("helix") > order.indexOf("vector"));
    assert.ok(order.indexOf("thermal") > order.indexOf("meridian"));
  });

  it("ranks the least recently used first among used surfaces", () => {
    const recent = [mem(sig({ surface: "helix" })), mem(sig({ surface: "thermal" }))];
    const order = underexposedSurfaces(["helix", "thermal"], recent);
    assert.deepEqual(order, ["thermal", "helix"]);
  });

  it("is deterministic when nothing has been used", () => {
    assert.deepEqual(underexposedSurfaces(ALL, []), underexposedSurfaces(ALL, []));
  });
});

describe("franchises", () => {
  it("renders a wordmark with its emoji", () => {
    assert.equal(franchiseWordmark("BLACKOUT_CONFLUENCE"), "⚡ BLACKOUT CONFLUENCE");
  });

  it("has a unique slug, label and emoji per franchise", () => {
    const slugs = X_INTEL_FRANCHISES.map((f) => f.slug);
    assert.equal(new Set(slugs).size, slugs.length);
    const labels = X_INTEL_FRANCHISES.map((f) => f.label);
    assert.equal(new Set(labels).size, labels.length);
  });

  it("keeps schedule-locked franchises out of the session rotation", () => {
    const session = eligibleFranchises({ slot: "session", hasPriorPackageToProve: true });
    assert.ok(!session.includes("BEFORE_THE_BELL"));
    assert.ok(!session.includes("AFTER_DARK"));
  });

  it("offers BEFORE THE BELL only in the premarket slot", () => {
    assert.deepEqual(eligibleFranchises({ slot: "premarket", hasPriorPackageToProve: false }), [
      "BEFORE_THE_BELL",
    ]);
  });

  it("offers AFTER DARK only after the close", () => {
    assert.deepEqual(eligibleFranchises({ slot: "after_close", hasPriorPackageToProve: false }), [
      "AFTER_DARK",
    ]);
  });

  it("withholds RECEIPTS when there is no prior package to prove", () => {
    // Receipts with no record behind them is a foresight claim in a different hat.
    const none = eligibleFranchises({ slot: "session", hasPriorPackageToProve: false });
    assert.ok(!none.includes("RECEIPTS"));
    const some = eligibleFranchises({ slot: "session", hasPriorPackageToProve: true });
    assert.ok(some.includes("RECEIPTS"));
  });

  it("penalises the franchise used last most heavily, without disqualifying it", () => {
    const p = franchiseRepeatPenalty("WHALE_WATCH", ["WHALE_WATCH"]);
    assert.ok(p > 0 && p < 0.5);
    assert.equal(franchiseRepeatPenalty("WHALE_WATCH", ["GAMMA_SHIFT"]), 1);
  });

  it("decays the penalty as the repeat recedes", () => {
    const hist: XIntelFranchise[] = ["GAMMA_SHIFT", "WHALE_WATCH"];
    assert.ok(
      franchiseRepeatPenalty("WHALE_WATCH", hist) >
        franchiseRepeatPenalty("WHALE_WATCH", ["WHALE_WATCH"]),
    );
  });
});

describe("view catalog", () => {
  it("has unique ids", () => {
    const ids = X_INTEL_VIEW_CATALOG.map((v) => v.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("offers MULTIPLE views per major surface — one shot per product is the failure mode", () => {
    for (const surface of ["helix", "thermal", "vector", "nighthawk", "meridian"]) {
      const n = X_INTEL_VIEW_CATALOG.filter((v) => v.surface === surface).length;
      assert.ok(n >= 3, `${surface} has only ${n} catalogued view(s)`);
    }
  });

  it("every catalogued route survives the never-capture check", () => {
    // A view the guard would refuse is a view that can never be captured — catching that here
    // rather than at 09:35 on a live story.
    //
    // #2510 landed, so this now asserts against the canonical deny-PLUS-allow guard: it proves
    // every catalogued route is on the ALLOWLIST, not merely absent from a denylist. A view whose
    // route the guard would refuse is a view that can never be captured.
    for (const v of X_INTEL_VIEW_CATALOG) {
      const verdict = checkCaptureUrl(`https://blackouttrades.com${v.path}`);
      assert.equal(verdict.ok, true, `${v.id} → ${v.path} refused by capture-guard`);
    }
  });

  it("every view carries a real verification precondition", () => {
    // Without one the harness screenshots loading skeletons and reports success.
    for (const v of X_INTEL_VIEW_CATALOG) {
      assert.ok(v.verify.trim().length > 20, `${v.id} has no meaningful verify`);
      assert.ok(v.frame.trim().length > 10, `${v.id} has no framing note`);
      assert.ok(v.reach.length > 0, `${v.id} has no reach steps`);
    }
  });

  it("indexes by id", () => {
    assert.equal(X_INTEL_VIEW_BY_ID["thermal.matrix"]?.surface, "thermal");
  });
});
