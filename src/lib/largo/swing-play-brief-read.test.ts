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
type AdaptFn = (result: unknown) => unknown;

// Default adapt() stub: an innocuous `ok:true` ProductRead, so every pre-existing test (which
// only asserts `available`/`error`/`unavailable`/hint-forwarding, never the Largo contract fields)
// keeps passing unmodified. Tests that care about the adapter's own output override `state.adapt`.
const defaultAdapt = () => ({
  ok: true,
  product: "swing",
  as_of: "2026-11-09 12:00 ET",
  freshness: "cached",
  age_seconds: null,
  source: "stub",
  data: { direction: "neutral", evidence: [] },
});

const state: { loadCtx: LoadCtxFn; compose: ComposeFn; adapt: AdaptFn } = {
  loadCtx: async () => {
    throw new Error("loadSwingPlayBriefContext not configured for this test");
  },
  compose: () => {
    throw new Error("composeSwingPlayBrief not configured for this test");
  },
  adapt: defaultAdapt,
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
mock.module("../swing/play-brief-adapter", {
  namedExports: {
    adaptSwingBriefToLargo: (result: unknown) => state.adapt(result),
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
  state.adapt = defaultAdapt;

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
  state.adapt = defaultAdapt;

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
  state.adapt = defaultAdapt;

  const v = await swingPlayBriefForLargo("nrg");
  assert.equal(v.available, true);
  assert.deepEqual(capturedOpts, { expandIntel: false });
});

// BUG FIX (Ask Largo standing mandate, 2026-11-09, Largo C2/C9): before this fix,
// `swingPlayBriefForLargo`'s success path returned `roundFloats({ available: true, ...brief })`
// verbatim — it never called `adaptSwingBriefToLargo` at all, so the contract's freshness
// classification/age_seconds/direction/evidence_numbers/source/cohort fields that the HTTP route
// (route.ts) already exposes NEVER reached a live Largo chat answer, and `distancePct` got the
// generic 2dp round instead of the narrative's own 1dp — a genuine double-round risk at a
// half-unit boundary. These tests pin that the adapter is now called with the composed brief and
// its fields land on the tool's response, and that a failed adapt degrades honestly.
test("calls adaptSwingBriefToLargo with the composed brief and merges its Largo contract fields onto the response", async () => {
  const brief = { verdict: ["stub"], envelope: { bias: "bullish" } };
  state.loadCtx = async () => ({ play: { ticker: "NRG" }, asOf: "2026-09-12T00:00:00Z" });
  state.compose = () => brief;
  let capturedAdaptInput: unknown = null;
  state.adapt = (result) => {
    capturedAdaptInput = result;
    return {
      ok: true,
      product: "swing",
      as_of: "2026-11-09 12:00 ET",
      freshness: "delayed",
      age_seconds: 300,
      source: "swing ledger",
      cohort: "swing",
      data: { direction: "bullish", evidence: ["entry $1.23"] },
    };
  };

  const v = await swingPlayBriefForLargo("nrg");
  assert.equal(capturedAdaptInput, brief, "adaptSwingBriefToLargo must be called with the exact composed brief");
  assert.equal(v.available, true);
  assert.equal((v as { as_of?: string }).as_of, "2026-11-09 12:00 ET");
  assert.equal((v as { freshness?: string }).freshness, "delayed");
  assert.equal((v as { age_seconds?: number }).age_seconds, 300);
  assert.equal((v as { direction?: string }).direction, "bullish");
  assert.deepEqual((v as { evidence_numbers?: string[] }).evidence_numbers, ["entry $1.23"]);
  assert.equal((v as { source?: string }).source, "swing ledger");
  assert.equal((v as { cohort?: string }).cohort, "swing");
  // The native brief fields must still be present — the contract fields are additive, never a
  // replacement (Largo contract: "ADDITIVE... never flatten away").
  assert.deepEqual((v as { verdict?: string[] }).verdict, ["stub"]);
});

test("falls back to the honest unavailable shape when adaptSwingBriefToLargo itself reports ok:false", async () => {
  state.loadCtx = async () => ({ play: { ticker: "NRG" }, asOf: "2026-09-12T00:00:00Z" });
  state.compose = () => ({ verdict: ["stub"] });
  state.adapt = () => ({
    ok: false,
    product: "swing",
    as_of: "2026-11-09 12:00 ET",
    freshness: "cached",
    age_seconds: null,
    source: "swing ledger",
    unavailable: { reason: "no identity could be derived", what_is_missing: "a resolvable ticker", retryable: false },
  });

  const v = await swingPlayBriefForLargo("nrg");
  assert.equal(v.available, false);
  assert.equal((v as { error?: string }).error, "swing brief unavailable");
  const unavailable = (v as { unavailable?: { reason: string; retryable: boolean } }).unavailable;
  assert.ok(unavailable, "expected the adapter's own unavailable shape to be forwarded");
  assert.equal(unavailable!.reason, "no identity could be derived");
  assert.equal(unavailable!.retryable, false);
});

test("distancePct gets the narrative's 1dp precision, not the generic 2dp default — no double-round vs the narrative text", async () => {
  // 0.825 is the exact shape that exposes the bug: the generic 2dp default would keep it at
  // 0.83 (already matches here), but a value whose SECOND decimal sits on a rounding tie
  // (e.g. 2.625) is where 2dp vs 1dp disagree with fmtPct's own 1dp narrative round. Assert the
  // wire value actually lands at 1dp, proving the {distancePct:1} override reached roundFloats.
  const brief = { structureLadder: { rungs: [{ distancePct: 2.625 }] } };
  state.loadCtx = async () => ({ play: { ticker: "NRG" }, asOf: "2026-09-12T00:00:00Z" });
  state.compose = () => brief;
  state.adapt = defaultAdapt;

  const v = await swingPlayBriefForLargo("nrg");
  assert.equal(v.available, true);
  const rung = (v as { structureLadder?: { rungs: { distancePct: number }[] } }).structureLadder?.rungs[0];
  // fmtPct's 1dp round of 2.625 is 2.6 (ties-to-even is irrelevant here; standard round gives
  // 2.6 at 1dp) — the point is it must NOT be the 2dp value (2.63/2.62) the generic default
  // would otherwise have produced for a value already rounded once upstream.
  assert.equal(rung?.distancePct, 2.6);
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
