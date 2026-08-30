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

const parsedStrike = { strike: 138, side: "call" as const, expiryYmd: "2026-09-04" };

mock.module("../../features/nighthawk/lib/option-chain-prompt", {
  namedExports: {
    parseOptionsContract: (text: string) => (text.includes("$138") ? parsedStrike : null),
    evaluatePlayAgainstChain: () => ({ ok: false, verified: false, contradicted: true, matchedOi: 3 }),
    fetchEditionChains: async () => ({
      MSTR: { rows: [{ strike: 138, expiry: "2026-09-04", call_oi: 3, put_oi: 0 }] },
    }),
    chainQuoteForParsedPlay: () => null,
    playPremiumWithinChainBand: () => true,
  },
});

const mod = () => import("./nighthawk-verifier");

// Regression guard: contraDetail used to unconditionally prepend play.ticker even though every
// real generator (formatOptionsPlay et al.) already writes options_play with the ticker as its
// own leading word — producing "MSTR MSTR $138 CALL @ $6.08 — Sep 4" in the live ops Discord
// alert (caught by eye in #website-logs). The detail must name the ticker exactly once.
test("chain-confirm: a CONTRADICTED play's detail names the ticker exactly once, not duplicated", async () => {
  const { verifyNightHawk } = await mod();
  state.edition = {
    edition_for: "2026-09-04",
    published_at: new Date().toISOString(),
    plays: [
      {
        rank: 1,
        ticker: "MSTR",
        direction: "LONG",
        conviction: "B",
        play_type: "stock",
        thesis: "t",
        key_signal: "k",
        entry_range: "$130-$140",
        target: "$150",
        stop: "$120",
        options_play: "MSTR $138 CALL @ $6.08 — Sep 4, entry prem ~$6.08",
      },
    ],
  };
  state.pulledRows = [];

  const score = await verifyNightHawk(false);
  const strikeMetric = score.metrics.find((m) => m.metric === "strike");
  assert.ok(strikeMetric, "strike metric present");
  assert.equal(strikeMetric!.status, "flag");
  const detail = strikeMetric!.checks[0]!.detail;
  assert.match(detail, /CONTRADICTED/);
  const mstrOccurrences = detail.match(/MSTR/g) ?? [];
  assert.equal(mstrOccurrences.length, 1, `expected exactly one "MSTR" in the detail, got: ${detail}`);
});
