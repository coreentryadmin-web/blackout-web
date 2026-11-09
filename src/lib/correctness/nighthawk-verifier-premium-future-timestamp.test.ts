import { test, mock } from "node:test";
import assert from "node:assert/strict";

// Regression for the future-published_at premium-freshness gate: `Date.now() - publishedAtMs`
// goes NEGATIVE for a future-dated `published_at` (cross-process clock skew on the Night Hawk
// cron writer), which always satisfies `<= 4h` and reads the edition as fresher than it really
// is — same bug shape already fixed at the GEX-heatmap context-edition and Helix flow-anomaly
// banner sites. A falsely-"fresh" edition lets the premium-vs-chain check run on a comparison
// it should have skipped, producing a false "flag" (premiumMismatch) verdict off garbage
// clock-skewed data instead of the honest "premium check skipped, edition freshness unproven".
//
// CORRECTED (this round): this test previously asserted the resulting "premium" metric comes
// back as "pass" — i.e. it locked in a SECOND bug riding on top of the first. The freshness gate
// correctly prevented the comparison from running, but the verifier still emitted the
// premium-vs-chain CHECK itself (`premium-vs-chain-ask`) as outcome "pass" with
// independentlyConfirmed:true, keyed off `confirmed` (strike-only) rather than whether a premium
// comparison actually executed. That is a direct violation of this verifier family's own HONESTY
// PRINCIPLE (types.ts): "pass" requires a second independent source to have actually confirmed
// the value — here, none did. The verifier now tracks `premiumChecked` separately from
// `confirmed` and emits that check as "skipped" (never independentlyConfirmed) when no premium
// comparison ran. (The metric-level `score.metrics` roll-up for "premium" still reads
// "consistency-only" overall, because the SEPARATE L2 premium_cap_ok invariant check — unrelated
// to chain-confirm, and which legitimately held on this fixture — shares the same metric name and
// is merged in by `rollUpMetricStatus`; this test asserts the specific chain-confirm CHECK by id,
// which is the thing the bug actually touched.)

mock.module("server-only", { namedExports: {} });

const state = {
  edition: null as { edition_for: string; published_at?: string; plays: unknown[] } | null,
  dossiers: [] as Array<{ ticker: string; dossier: Record<string, unknown>; scored: Record<string, unknown> | null }>,
  pulledRows: [] as Array<{ ticker: string; pulled_reason: string | null; pulled_at: string | null }>,
};

mock.module("../db", {
  namedExports: {
    fetchLatestNighthawkEdition: async () => state.edition,
    fetchStagedDossiers: async () => state.dossiers,
    fetchNighthawkPulledPlays: async (editionFor: string) =>
      state.pulledRows.filter((r) => editionFor === state.edition?.edition_for),
  },
});

const parsedStrike = { strike: 185, side: "call" as const, expiryYmd: "2026-08-07" };

// Every sampled strike VERIFIES against the chain, and the chain quote is intentionally far from
// the play's entry premium — a real premium check on this data would/could flag it. The test
// asserts the check is SKIPPED (edition freshness unproven from a future publish stamp), not that
// it happens to pass.
mock.module("../../features/nighthawk/lib/option-chain-prompt", {
  namedExports: {
    parseOptionsContract: (text: string) => (text.includes("$185") ? parsedStrike : null),
    evaluatePlayAgainstChain: () => ({ ok: true, verified: true, contradicted: false, matchedOi: 5000 }),
    fetchEditionChains: async () => ({
      ANET: { rows: [{ strike: 185, expiry: "2026-08-07", call_oi: 5000, put_oi: 0 }] },
    }),
    chainQuoteForParsedPlay: () => ({ ref: 999, bid: 990, ask: 1010 }),
    playPremiumWithinChainBand: () => false,
  },
});

const mod = () => import("./nighthawk-verifier");

test("chain-confirm: a future-dated published_at (clock skew) does NOT count as fresh for the premium-vs-chain check", async () => {
  const { verifyNightHawk } = await mod();
  const editionFor = new Date().toISOString().slice(0, 10);
  state.edition = {
    edition_for: editionFor,
    // Clock-skewed 30-minute-ahead publish stamp — well beyond the 60s future tolerance, but a
    // raw `now - publishedAt <= 4h` subtraction reads this as fresh because the age is negative.
    published_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    plays: [
      {
        rank: 1,
        ticker: "ANET",
        direction: "LONG",
        conviction: "B",
        play_type: "stock",
        thesis: "t",
        key_signal: "k",
        entry_range: "$180-$190",
        target: "$200",
        stop: "$170",
        entry_premium: 10.03,
        options_play: "ANET $185 CALL @ $10.03 — Aug 7, entry prem ~$10.03",
      },
    ],
  };
  state.pulledRows = [];

  const score = await verifyNightHawk(false);
  const premiumMetric = score.metrics.find((m) => m.metric === "premium");
  assert.ok(premiumMetric, "premium metric present (a strike still confirmed against the chain)");
  const chainConfirmCheck = premiumMetric!.checks.find((c) => c.id.includes("premium-vs-chain-ask"));
  assert.ok(chainConfirmCheck, "premium-vs-chain-ask check must be present");
  // The chain quote ($999 ref) is wildly outside the play's $10.03 entry premium, and
  // `playPremiumWithinChainBand` is mocked to always return false — so if the premium-vs-chain
  // comparison actually ran (the first bug), it flags a mismatch ("flag"). If the comparison is
  // correctly skipped but still falsely reported as confirmed (the second bug this round fixes),
  // it reads "pass". The honest outcome is neither: "skipped", because no independent source
  // ever confirmed anything this run.
  assert.equal(
    chainConfirmCheck!.outcome,
    "skipped",
    "future-dated published_at must not be treated as fresh — the premium-vs-chain comparison must be skipped AND reported as skipped, not run-and-flagged nor falsely reported as confirmed"
  );
  assert.equal(
    chainConfirmCheck!.independentlyConfirmed,
    false,
    "a skipped comparison must never be marked independentlyConfirmed"
  );
  assert.doesNotMatch(chainConfirmCheck!.detail, /OUTSIDE the chain bid\/ask band/);
  assert.doesNotMatch(chainConfirmCheck!.detail, /sit within the live chain bid\/ask band/);
});
