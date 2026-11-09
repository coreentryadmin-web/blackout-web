import { test, mock } from "node:test";
import assert from "node:assert/strict";

// largo-live-feed.ts transitively imports gex-positioning.ts, which carries a real
// `import "server-only"` — throws under plain Node outside a Next.js server bundle, same stub
// every sibling test in this repo uses (see meridian-for-largo.test.ts's identical header).
mock.module("server-only", { namedExports: {} });

// Lazy, per-test import — mock.module() registrations above must land before the module under
// test is first loaded, and a top-level `await import(...)` is not supported under tsx's cjs
// transform (confirmed empirically), so every test resolves this itself.
const mod = () => import("./largo-live-feed");
type LargoLiveFeed = Partial<Record<string, unknown>>;

/**
 * `captureLargoLiveFeed` pre-populates `spx_confluence`, `lotto_live` and `power_hour`
 * specifically so Largo sees them "without the tool-call round-trip" (see that function's
 * own comments: "Pre-populate spx_confluence ... so Largo sees it", "Always inject when the
 * SPX desk is in scope so Largo has lotto context for desk questions"). But the ONLY consumer
 * that turns the captured feed into something the model actually reads during generation is
 * `formatLargoLiveFeed` (the prose block assembled into the system prompt, largo-terminal.ts)
 * — the raw `LargoLiveFeed` object itself is never serialized to the model, only used
 * after-the-fact for answer-grounding (`collectContextNumbers`/`findSourceConflicts`).
 *
 * Pre-fix, `formatLargoLiveFeed` never read `feed.spx_confluence`, `feed.lotto_live` or
 * `feed.power_hour` at all — confirmed by grepping the whole function body. So every upstream
 * read (`getLargoSpxLiveDesk`, `computeSpxConfluence`, `loadLottoRecord`) done specifically to
 * pre-populate these fields was spent for nothing: the model never saw the result during
 * generation, and still had to call `get_spx_confluence`/`get_lotto_state` itself — the exact
 * round-trip the pre-population comment says it exists to avoid.
 *
 * Combined-fixture style (not a trivial single-field check): builds one realistic feed with
 * ALL THREE fields populated alongside a section that already DID render (spx_structure), so
 * the test fails loudly if any of the three siblings is still silently dropped.
 */
function combinedFixture(): LargoLiveFeed {
  return {
    spx_structure: {
      price: 6812.4,
      vix: 14.9,
    },
    spx_confluence: {
      action: "BUY_CALL",
      bias: "bullish",
      score: 61,
      grade: "A",
      agreeing: 4,
      conflicts: 1,
      weighted_conflicts: 0.6,
      direction: "long",
    },
    lotto_live: {
      available: true,
      phase: "entry_zone",
      direction: "long",
      contract_label: "SPX 6820C 0DTE",
      headline: "Lotto entry zone active",
      status_message: "Waiting for confirmation above 6815.",
    },
    power_hour: {
      active: true,
      minutes_remaining: 42,
    },
  };
}

test("formatLargoLiveFeed surfaces spx_confluence — RED before the fix, GREEN after", async () => {
  const { formatLargoLiveFeed } = await mod();
  const out = formatLargoLiveFeed(combinedFixture() as never, "SPX");
  assert.ok(
    out.includes("BUY_CALL") && out.includes("61") && out.includes("grade A"),
    `expected the confluence action/score/grade to reach the model's context; got:\n${out}`
  );
});

test("formatLargoLiveFeed surfaces lotto_live", async () => {
  const { formatLargoLiveFeed } = await mod();
  const out = formatLargoLiveFeed(combinedFixture() as never, "SPX");
  assert.ok(
    out.includes("SPX 6820C 0DTE") && out.includes("entry_zone"),
    `expected the live lotto phase/contract to reach the model's context; got:\n${out}`
  );
});

test("formatLargoLiveFeed surfaces power_hour", async () => {
  const { formatLargoLiveFeed } = await mod();
  const out = formatLargoLiveFeed(combinedFixture() as never, "SPX");
  assert.ok(
    out.includes("Power hour") && out.includes("42"),
    `expected the power-hour window to reach the model's context; got:\n${out}`
  );
});

test("formatLargoLiveFeed omits spx_confluence cleanly when it carries only an error", async () => {
  const { formatLargoLiveFeed } = await mod();
  const feed: LargoLiveFeed = { spx_confluence: { error: "No confluence — SPX desk not live yet." } };
  const out = formatLargoLiveFeed(feed as never, "SPX");
  assert.ok(!out.includes("Action:"), `an error-only confluence must not render a fake action line; got:\n${out}`);
});

test("formatLargoLiveFeed omits lotto_live cleanly when unavailable", async () => {
  const { formatLargoLiveFeed } = await mod();
  const feed: LargoLiveFeed = { lotto_live: { available: false, note: "No live lotto record for today yet." } };
  const out = formatLargoLiveFeed(feed as never, "SPX");
  assert.ok(!out.includes("SPX lotto"), `an unavailable lotto record must not render a fake section; got:\n${out}`);
});

test("formatLargoLiveFeed omits power_hour when inactive/absent", async () => {
  const { formatLargoLiveFeed } = await mod();
  const out = formatLargoLiveFeed({} as never, "SPX");
  assert.ok(!out.includes("Power hour"), `no power_hour field should render nothing; got:\n${out}`);
});
