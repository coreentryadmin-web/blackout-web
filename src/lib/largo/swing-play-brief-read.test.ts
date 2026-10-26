import { before, test, mock } from "node:test";
import assert from "node:assert/strict";

// mock.module() specifiers must match what tsx rewrites the module-under-test's own "@/..."
// imports to at load time — a RELATIVE path from THIS test file's location, never the "@/" alias
// itself (tsx only rewrites statically-parsed top-level `import ... from` in the file being
// compiled, not a mock.module() call's own string argument or a dynamic import()). See
// src/lib/flow-gex-enrichment.test.ts's header comment and run-tool.test.ts (same directory).
// swing-play-brief-read.ts's real dependency chain pulls in `server-only` (via play-brief-
// context.ts -> ... -> gex-positioning.ts), so both upstream modules must be mocked before the
// module under test is ever imported.
//
// Since ESM caches a module on first import, re-importing swing-play-brief-read per test would
// keep replaying whichever mock implementation was active at that first import forever (same
// gotcha src/app/api/platform/intel/route.test.ts documents) — so the mocks are registered ONCE
// here, each reading a mutable box set fresh by every test, and the module under test is imported
// ONCE in before().

type LoadCtxFn = (input: unknown) => Promise<unknown>;
type ComposeFn = (ctx: unknown, opts?: unknown) => unknown;

const state: { loadCtx: LoadCtxFn; compose: ComposeFn } = {
  loadCtx: async () => {
    throw new Error("loadSwingPlayBriefContext not configured for this test");
  },
  compose: () => {
    throw new Error("composeSwingPlayBrief not configured for this test");
  },
};

mock.module("../swing/play-brief-context", {
  namedExports: {
    loadSwingPlayBriefContext: (input: unknown) => state.loadCtx(input),
  },
});
mock.module("../swing/play-brief", {
  namedExports: {
    // Threads `opts` through too (not just `ctx`) — this is what proves/would-catch the
    // `expandIntel` tool parameter (2026-10-26) actually reaching `composeSwingPlayBrief`.
    composeSwingPlayBrief: (ctx: unknown, opts?: unknown) => state.compose(ctx, opts),
  },
});

let swingPlayBriefForLargo: (typeof import("./swing-play-brief-read"))["swingPlayBriefForLargo"];

before(async () => {
  ({ swingPlayBriefForLargo } = await import("./swing-play-brief-read"));
});

test("requires a ticker — never composes a brief for an empty ticker", async () => {
  const v = await swingPlayBriefForLargo("");
  assert.equal(v.available, false);
  assert.equal((v as { error?: string }).error, "ticker_required");
  // BUG FIX (Ask Largo standing mandate, 2026-10-19, Largo C3): every failure path here used to
  // return a bare {available:false, error} with no reason/what_is_missing/retryable, the exact
  // "unavailable with no stated reason" shape the contract calls a defect.
  const unavailable = (v as { unavailable?: { reason: string; what_is_missing: string; retryable: boolean } })
    .unavailable;
  assert.ok(unavailable, "expected an `unavailable` field on a ticker_required failure");
  assert.equal(unavailable!.retryable, false);
  assert.match(unavailable!.what_is_missing, /ticker/);
});

test("resolves with the ticker uppercased and forwards optional hints to the context loader", async () => {
  let capturedInput: unknown = null;
  state.loadCtx = async (input) => {
    capturedInput = input;
    return { play: { ticker: "NRG" }, asOf: "2026-09-12T00:00:00Z" };
  };
  state.compose = () => ({ verdict: ["stub"] });

  const v = await swingPlayBriefForLargo("nrg", { positionId: 34, status: "OPEN", strike: 90, right: "call" });
  assert.equal(v.available, true);
  assert.deepEqual(capturedInput, {
    playId: "SWING:NRG",
    ticker: "NRG",
    positionId: 34,
    status: "OPEN",
    strike: 90,
    right: "call",
  });
});

// BUG FIX (Ask Largo standing mandate, 2026-10-26): before this fix, `swingPlayBriefForLargo`
// always called `composeSwingPlayBrief(ctx)` with no second argument, so `opts?.expandIntel` was
// unconditionally undefined and `collapseIntel` (play-brief.ts) was unconditionally forced true —
// Largo's tool-calling surface had no way to reach the uncollapsed read the Command Deck UI's own
// `?expandIntel=1` toggle already could. These two tests pin that `expandIntel` now actually
// reaches `composeSwingPlayBrief`'s options in both directions.
test("expandIntel:true is forwarded to composeSwingPlayBrief's options — Largo can now request the uncollapsed read", async () => {
  let capturedOpts: unknown = null;
  state.loadCtx = async () => ({ play: { ticker: "NRG" }, asOf: "2026-09-12T00:00:00Z" });
  state.compose = (_ctx, opts) => {
    capturedOpts = opts;
    return { verdict: ["stub"] };
  };

  const v = await swingPlayBriefForLargo("nrg", { expandIntel: true });
  assert.equal(v.available, true);
  assert.deepEqual(capturedOpts, { expandIntel: true });
});

test("expandIntel omitted defaults to false — the default tool answer stays the collapsed narrative read", async () => {
  let capturedOpts: unknown = null;
  state.loadCtx = async () => ({ play: { ticker: "NRG" }, asOf: "2026-09-12T00:00:00Z" });
  state.compose = (_ctx, opts) => {
    capturedOpts = opts;
    return { verdict: ["stub"] };
  };

  const v = await swingPlayBriefForLargo("nrg");
  assert.equal(v.available, true);
  assert.deepEqual(capturedOpts, { expandIntel: false });
});

test("returns available:false with error:play_not_found rather than fabricating a brief when nothing resolves", async () => {
  state.loadCtx = async () => null;
  state.compose = () => {
    throw new Error("composeSwingPlayBrief must not run when context resolution fails");
  };

  const v = await swingPlayBriefForLargo("ZZZZ");
  assert.equal(v.available, false);
  assert.equal((v as { error?: string }).error, "play_not_found");
  assert.match((v as { note?: string }).note ?? "", /ZZZZ/);
  const unavailable = (v as { unavailable?: { reason: string; what_is_missing: string; retryable: boolean } })
    .unavailable;
  assert.ok(unavailable, "expected an `unavailable` field on a play_not_found failure");
  assert.equal(unavailable!.retryable, false);
  assert.match(unavailable!.reason, /ZZZZ/);
});

test("a thrown error from the pipeline degrades to available:false, never a crash", async () => {
  state.loadCtx = async () => {
    throw new Error("db_unreachable");
  };

  const v = await swingPlayBriefForLargo("NRG");
  assert.equal(v.available, false);
  assert.equal((v as { error?: string }).error, "db_unreachable");
  const unavailable = (v as { unavailable?: { reason: string; what_is_missing: string; retryable: boolean } })
    .unavailable;
  assert.ok(unavailable, "expected an `unavailable` field on a thrown-error failure");
  // An uncaught exception is the ambiguous "transient or real bug" case the contract's
  // retryable flag exists for — default true, since this layer can't tell them apart either.
  assert.equal(unavailable!.retryable, true);
  assert.equal(unavailable!.reason, "db_unreachable");
});
