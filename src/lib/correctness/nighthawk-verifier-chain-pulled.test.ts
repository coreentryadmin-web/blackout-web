import { test, mock } from "node:test";
import assert from "node:assert/strict";

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

mock.module("../../features/nighthawk/lib/option-chain-prompt", {
  namedExports: {
    parseOptionsContract: (text: string) => (text.includes("$185") ? parsedStrike : null),
    evaluatePlayAgainstChain: () => ({ ok: false, verified: false, contradicted: true, matchedOi: 324 }),
    fetchEditionChains: async () => ({
      ANET: { rows: [{ strike: 185, expiry: "2026-08-07", call_oi: 324, put_oi: 0 }] },
    }),
    chainQuoteForParsedPlay: () => null,
    playPremiumWithinChainBand: () => true,
  },
});

const mod = () => import("./nighthawk-verifier");

test("chain-confirm: pulled latch rows exclude tickers from strike sampling (no false FLAG)", async () => {
  const { verifyNightHawk } = await mod();
  state.edition = {
    edition_for: "2026-08-04",
    published_at: new Date().toISOString(),
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
        options_play: "ANET $185 CALL @ $10.03 — Aug 7, entry prem ~$10.03",
      },
    ],
  };
  state.pulledRows = [
    {
      ticker: "ANET",
      pulled_reason: "Pulled pre-open: Cortex veto",
      pulled_at: "2026-08-04T09:15:00.000Z",
    },
  ];

  const score = await verifyNightHawk(false);
  const strikeMetric = score.metrics.find((m) => m.metric === "strike");
  assert.ok(strikeMetric, "strike metric present");
  assert.equal(
    strikeMetric!.status,
    "consistency-only",
    "latch-pulled ticker → no chain sample → not a FLAG"
  );
  assert.doesNotMatch(strikeMetric!.checks[0]!.detail, /CONTRADICTED/);
  assert.doesNotMatch(strikeMetric!.checks[0]!.detail, /ANET/);
});
