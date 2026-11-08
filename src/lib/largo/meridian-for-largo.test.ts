import assert from "node:assert/strict";
import { test, mock } from "node:test";

// meridian-for-largo.ts pulls in a real `import "server-only"`, which throws under plain Node
// outside a Next.js server bundle — same stub every sibling test in this repo uses.
mock.module("server-only", { namedExports: {} });

// mock.module()'s own specifier must be RELATIVE to meridian-for-largo.ts's own directory
// (src/lib/largo/), mirroring the resolved form of its real `@/lib/meridian/meridian-snapshot`
// static top-level import — tsx rewrites path ALIASES for a statically-parsed top-level import
// of the file under test, but NOT for mock.module()'s own specifier string, so mock.module must
// be given the ALREADY-RESOLVED relative path, not the "@/..." alias itself. Confirmed empirically
// before writing this file: `mock.module("@/lib/meridian/meridian-snapshot", ...)` silently fails
// to intercept (tsx tries to resolve "@/..." as a literal relative path from this file's own
// directory and throws ERR_MODULE_NOT_FOUND), while `mock.module("../meridian/meridian-snapshot",
// ...)` intercepts correctly. Same underlying tsx behavior pre-earnings-pack.test.ts's own header
// comment documents for dynamic import() calls — this is the sibling case for a STATIC import.
let timelinePayload: {
  as_of: string;
  stats: Record<string, unknown>;
  board_tickers: string[];
  items: Array<{
    id: string;
    kind: string;
    title: string;
    ticker: string | null;
    date: string;
    days_until: number;
    impact: string;
  }>;
  earnings_calendar_entitled: boolean;
} | null = null;
let shouldThrow = false;

mock.module("../meridian/meridian-snapshot", {
  namedExports: {
    loadMeridianTimelineResponse: async () => {
      if (shouldThrow) throw new Error("boom");
      return timelinePayload;
    },
  },
});

const mod = () => import("./meridian-for-largo");

// BUG FIX (2026-11-08, Ask Largo standing mandate): a second, independent occurrence of the SAME
// bug class as play-brief-meridian.ts's `SwingMeridianCatalystSlice.calendar_entitled` fix (and a
// sibling to PR #7586's `earnings_error` fix on pre-earnings-pack.ts) — this function's success
// path reported `available: true` regardless of whether the underlying Benzinga earnings-calendar
// fetch was itself entitled, so a refused/errored fetch (live, 2026-11-07: the Benzinga
// entitlement 403) read identically to a genuinely quiet window. RED→GREEN pin: pre-fix, the
// returned object has no `calendar_entitled` key at all (undefined), so this assertion fails.
test("meridianTimelineForLargo: forwards a FAILED calendar entitlement instead of dropping it (live Benzinga 403)", async () => {
  shouldThrow = false;
  timelinePayload = {
    as_of: "2026-11-07T09:00:00.000Z",
    stats: {},
    board_tickers: [],
    items: [],
    earnings_calendar_entitled: false,
  };
  const { meridianTimelineForLargo } = await mod();
  const result = await meridianTimelineForLargo(14);
  assert.equal(result.available, true, "the try block itself did not throw");
  assert.equal(
    result.calendar_entitled,
    false,
    "a refused/errored calendar fetch must be forwarded, not dropped",
  );
});

// No-regression companion: a genuinely healthy, entitled read must still report
// `calendar_entitled: true`, not a false alarm.
test("meridianTimelineForLargo: a genuinely entitled read reports calendar_entitled true — no regression", async () => {
  shouldThrow = false;
  timelinePayload = {
    as_of: "2026-11-07T09:00:00.000Z",
    stats: {},
    board_tickers: [],
    items: [
      {
        id: "earnings:CAVA:2026-11-10",
        kind: "earnings",
        title: "CAVA earnings",
        ticker: "CAVA",
        date: "2026-11-10",
        days_until: 3,
        impact: "high",
      },
    ],
    earnings_calendar_entitled: true,
  };
  const { meridianTimelineForLargo } = await mod();
  const result = await meridianTimelineForLargo(14);
  assert.equal(result.available, true);
  assert.equal(result.calendar_entitled, true);
  assert.equal(result.upcoming_7d?.length, 1);
});

// No-regression companion: a thrown read (the outer try/catch's own pre-existing failure path)
// must still report `available: false` with a null upcoming_7d — unchanged by this fix, since a
// read that never completed has no entitlement answer to report either way.
test("meridianTimelineForLargo: a thrown read still reports available:false / upcoming_7d:null — no regression", async () => {
  shouldThrow = true;
  const { meridianTimelineForLargo } = await mod();
  const result = await meridianTimelineForLargo(14);
  assert.equal(result.available, false);
  assert.equal(result.upcoming_7d, null);
  assert.equal(result.calendar_entitled, null);
});
