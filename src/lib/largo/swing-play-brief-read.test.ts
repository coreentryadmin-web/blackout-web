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
type ComposeFn = (ctx: unknown) => unknown;

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
    composeSwingPlayBrief: (ctx: unknown) => state.compose(ctx),
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

test("returns available:false with error:play_not_found rather than fabricating a brief when nothing resolves", async () => {
  state.loadCtx = async () => null;
  state.compose = () => {
    throw new Error("composeSwingPlayBrief must not run when context resolution fails");
  };

  const v = await swingPlayBriefForLargo("ZZZZ");
  assert.equal(v.available, false);
  assert.equal((v as { error?: string }).error, "play_not_found");
  assert.match((v as { note?: string }).note ?? "", /ZZZZ/);
});

test("a thrown error from the pipeline degrades to available:false, never a crash", async () => {
  state.loadCtx = async () => {
    throw new Error("db_unreachable");
  };

  const v = await swingPlayBriefForLargo("NRG");
  assert.equal(v.available, false);
  assert.equal((v as { error?: string }).error, "db_unreachable");
});
