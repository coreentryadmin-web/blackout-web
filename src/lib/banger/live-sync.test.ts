import { test } from "node:test";
import assert from "node:assert/strict";
import { runBangerLiveSync, type BangerLiveSyncRow } from "./live-sync.ts";

function baseRow(overrides: Partial<BangerLiveSyncRow> = {}): BangerLiveSyncRow {
  return {
    id: 1,
    ticker: "ANET",
    contract_occ: "O:ANET260814C00105000",
    entry_premium: 1.5,
    peak_premium: null,
    scaled_already: false,
    partial_realized_premium: null,
    status: "OPEN",
    ...overrides,
  };
}

test("runBangerLiveSync no-ops entirely when the kill-switch is off", async () => {
  const result = await runBangerLiveSync({
    fetchOpenPositions: async () => {
      throw new Error("must not be called");
    },
    fetchMarks: async () => new Map(),
    updateLiveState: async () => {
      throw new Error("must not be called");
    },
    env: { BANGER_ENGINE_ENABLED: "off" } as NodeJS.ProcessEnv,
  });
  assert.equal(result.skipped, true);
});

test("runBangerLiveSync HOLDs when mark is between the hard stop and the 2x partial", async () => {
  const updates: unknown[] = [];
  const result = await runBangerLiveSync({
    fetchOpenPositions: async () => [baseRow()],
    fetchMarks: async () => new Map([["O:ANET260814C00105000", 2.0]]), // 1.33x entry
    updateLiveState: async (id, u) => {
      updates.push({ id, ...u });
    },
    env: {} as NodeJS.ProcessEnv,
  });
  assert.equal(result.refreshed, 1);
  assert.equal(result.transitions.length, 0);
  assert.equal((updates[0] as { status: string }).status, "OPEN");
});

test("runBangerLiveSync fires TAKE_PARTIAL at 2x and freezes the partial realized premium", async () => {
  const updates: Array<Record<string, unknown>> = [];
  const result = await runBangerLiveSync({
    fetchOpenPositions: async () => [baseRow()],
    fetchMarks: async () => new Map([["O:ANET260814C00105000", 3.5]]), // >= 2x entry (3.0)
    updateLiveState: async (id, u) => {
      updates.push({ id, ...u });
    },
  });
  assert.equal(result.transitions.length, 1);
  assert.equal(result.transitions[0]!.action, "TAKE_PARTIAL");
  const u = updates[0]!;
  assert.equal(u.status, "PARTIAL");
  assert.equal(u.scaledNow, true);
  assert.equal(u.partialRealizedPremium, 0.5 * 1.5 * 2.0); // scale_fraction * entry * scale_at_mult
});

test("runBangerLiveSync fires STOP_OUT at the hard stop and computes realized loss", async () => {
  const updates: Array<Record<string, unknown>> = [];
  await runBangerLiveSync({
    fetchOpenPositions: async () => [baseRow({ entry_premium: 2 })],
    fetchMarks: async () => new Map([["O:ANET260814C00105000", 0.7]]), // below 0.4x entry (0.8)
    updateLiveState: async (id, u) => {
      updates.push({ id, ...u });
    },
  });
  const u = updates[0]!;
  assert.equal(u.status, "STOPPED");
  // realized = 1 * (entry * hard_stop_mult) = 2 * 0.4 = 0.8 -> pct = (0.8/2 - 1)*100 = -60
  assert.ok(Math.abs((u.realizedPnlPct as number) - -60) < 1e-9);
});

test("runBangerLiveSync fires EXIT_RUNNER after a partial, using the pinned partial + remainder", async () => {
  const updates: Array<Record<string, unknown>> = [];
  await runBangerLiveSync({
    fetchOpenPositions: async () => [
      baseRow({ status: "PARTIAL", scaled_already: true, peak_premium: 4, partial_realized_premium: 1.5 }),
    ],
    fetchMarks: async () => new Map([["O:ANET260814C00105000", 1.9]]), // <= 50% of peak(4) = 2.0
    updateLiveState: async (id, u) => {
      updates.push({ id, ...u });
    },
  });
  const u = updates[0]!;
  assert.equal(u.status, "CLOSED_RUNNER");
  // partial 1.5 (pinned) + remaining 0.5 * mark(1.9) = 1.5 + 0.95 = 2.45; entry 1.5 -> pct = (2.45/1.5-1)*100
  const expectedPct = (2.45 / 1.5 - 1) * 100;
  assert.ok(Math.abs((u.realizedPnlPct as number) - expectedPct) < 1e-6);
});

test("runBangerLiveSync skips (no-quote) a row with no usable mark, without throwing", async () => {
  const updates: unknown[] = [];
  const result = await runBangerLiveSync({
    fetchOpenPositions: async () => [baseRow()],
    fetchMarks: async () => new Map(), // no quote for the OCC
    updateLiveState: async (id, u) => {
      updates.push({ id, ...u });
    },
  });
  assert.equal(result.noQuote, 1);
  assert.equal(result.refreshed, 0);
  assert.equal(updates.length, 0);
});
