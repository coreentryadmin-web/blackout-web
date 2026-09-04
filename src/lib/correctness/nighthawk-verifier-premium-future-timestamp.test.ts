import { test, mock } from "node:test";
import assert from "node:assert/strict";

// Regression for the future-published_at premium-freshness gate: `Date.now() - publishedAtMs`
// goes NEGATIVE for a future-dated `published_at` (cross-process clock skew on the Night Hawk
// cron writer), which always satisfies `<= 4h` and reads the edition as fresher than it really
// is — same bug shape already fixed at the GEX-heatmap context-edition and Helix flow-anomaly
// banner sites. A falsely-"fresh" edition lets the premium-vs-chain check run on a comparison
// it should have skipped, producing a false "flag" (premiumMismatch) verdict off garbage
// clock-skewed data instead of the honest "premium check skipped, edition freshness unproven".

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
  // The chain quote ($999 ref) is wildly outside the play's $10.03 entry premium, and
  // `playPremiumWithinChainBand` is mocked to always return false — so if the premium-vs-chain
  // comparison actually ran (the bug), it flags a mismatch. The freshness gate must skip that
  // comparison entirely for a clock-skewed future publish stamp, leaving premiumMismatch at 0.
  assert.equal(
    premiumMetric!.status,
    "pass",
    "future-dated published_at must not be treated as fresh — the premium-vs-chain comparison must be skipped, not run and falsely flagged"
  );
  assert.doesNotMatch(premiumMetric!.checks[0]!.detail, /OUTSIDE the chain bid\/ask band/);
});
