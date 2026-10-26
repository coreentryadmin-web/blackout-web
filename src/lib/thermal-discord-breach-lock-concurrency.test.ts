import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

// REGRESSION (round 115, sibling of the X-marketing lane's recordPostHook/markTweetReplied/
// recordBudgetUse fixes and the GEX-regime-events cursor fix — same bug shape, different file).
//
// `runThermalBreachAlerts` (thermal-discord-run.ts) used to do an UNLOCKED read-modify-write
// against the single shared `thermal-discord:breach-state:v1` Redis key:
//   loadThermalBreachState() -> per-event filterNewBreachAlerts() diff -> saveThermalBreachState()
// The module's OWN header comment says the surrounding route is "shared by main cron + 5m
// breach poller" — two independent EventBridge schedules hit the SAME `/api/cron/thermal-
// discord` route, and at every :00/:15/:30/:45 wall-clock minute they land on the same minute,
// so overlapping invocations are a real, scheduled occurrence, not a hypothetical.
//
// Two overlapping calls that both detect a DIFFERENT real crossing (e.g. the main cron sees
// SPY's flip cross while the poller, off its own slightly-later fetch, sees QQQ's call wall
// break) both read the same base state before either saves, so whichever save lands last wins
// outright — the other call's state update is silently discarded. The next tick then re-detects
// the discarded crossing as "new" again and double-posts a Discord alert for a crossing that
// should already have been marked seen.
//
// Fake `loadThermalBreachState`/`saveThermalBreachState` below model exactly that interleaving:
// the load resolves on a macrotask tick (like a real Redis round-trip) so two concurrent calls
// both read the pre-update value before either call's save lands. Fake `tryAdvisoryLock`/
// `releaseAdvisoryLock` model a real Postgres session-scoped advisory lock: non-blocking "try"
// semantics, held by at most one caller at a time.

type FakeBreachEvent = {
  ticker: string;
  kind: string;
  direction: "crossed_above" | "crossed_below";
};
type FakeBreachState = Record<string, Partial<Record<string, "above" | "below">>>;

let breachStateStore: FakeBreachState = {};
let lockHolder: symbol | null = null;
let webhookOutcomes: Record<string, boolean> = {};
const postedDedupKeys: string[] = [];

function sideFromDirection(direction: "crossed_above" | "crossed_below"): "above" | "below" {
  return direction === "crossed_above" ? "above" : "below";
}

// Faithful reimplementation of the real filterNewBreachAlerts (thermal-discord-breach-state.ts):
// alert only when the side changes for ticker+kind, else silent — same semantics, just inlined
// here so this module mock doesn't need to re-export the real pure function from a module this
// test is otherwise replacing wholesale.
function fakeFilterNewBreachAlerts(
  events: FakeBreachEvent[],
  state: FakeBreachState
): { alerts: FakeBreachEvent[]; state: FakeBreachState } {
  const next: FakeBreachState = { ...state };
  const alerts: FakeBreachEvent[] = [];
  for (const ev of events) {
    const ticker = ev.ticker.toUpperCase();
    const side = sideFromDirection(ev.direction);
    const prev = next[ticker]?.[ev.kind];
    if (prev === side) continue;
    alerts.push(ev);
    next[ticker] = { ...next[ticker], [ev.kind]: side };
  }
  return { alerts, state: next };
}

mock.module("./db", {
  namedExports: {
    tryAdvisoryLock: async (_lockKey: string): Promise<boolean> => {
      if (lockHolder !== null) return false;
      lockHolder = Symbol();
      return true;
    },
    releaseAdvisoryLock: async (_lockKey: string): Promise<void> => {
      lockHolder = null;
    },
  },
});

mock.module("./discord-post", {
  namedExports: {
    postDiscordWebhook: async (
      _webhook: string,
      _payload: unknown,
      dedupKey: string
    ): Promise<boolean> => {
      postedDedupKeys.push(dedupKey);
      // Force a real async gap so the webhook POST genuinely overlaps with a sibling call's
      // own load/post/save cycle — the same interleaving a slow real Discord round-trip creates.
      await new Promise((r) => setTimeout(r, 5));
      return webhookOutcomes[dedupKey] ?? true;
    },
    postDiscordWebhookWithFiles: async (): Promise<boolean> => true,
  },
});

mock.module("./et-date", {
  namedExports: {
    todayEt: (): string => "2026-10-26",
  },
});

mock.module("./discord-eod-recap", {
  namedExports: {
    currentSessionDateEt: (): string => "2026-10-26",
  },
});

mock.module("./thermal-discord-card", {
  namedExports: {
    renderThermalDiscordCardPng: async (): Promise<Uint8Array> => new Uint8Array(),
  },
});

mock.module("./thermal-discord-cadence", {
  namedExports: {
    extractWallSnapshot: (): Record<string, unknown> => ({}),
    loadThermalWallSnapshot: async (): Promise<null> => null,
    resolveThermalDiscordMode: (): "full" | "pulse" => "pulse",
    saveThermalWallSnapshot: async (): Promise<void> => {},
  },
});

mock.module("./thermal-discord-extras", {
  namedExports: {
    // Tests pass the already-constructed FakeBreachEvent[] in as `columns`, so this mock just
    // hands it straight through — the real detection logic (a pure diff of spot vs prior spot)
    // isn't what this test is exercising; the shared-state race downstream of it is.
    detectThermalBreaches: (columns: unknown): FakeBreachEvent[] => columns as FakeBreachEvent[],
    buildThermalBreachAlertEmbed: (): Record<string, unknown> => ({}),
    buildThermalDiscordEmbedWithExtras: (): Record<string, unknown> => ({}),
    buildThermalEodRecapEmbed: (): Record<string, unknown> => ({}),
  },
});

mock.module("./thermal-discord-eod", {
  namedExports: {
    claimThermalEodRecap: async (): Promise<boolean> => false,
    isThermalEodRecapDue: (): boolean => false,
  },
});

mock.module("./thermal-discord-breach-state", {
  namedExports: {
    loadThermalSpotMeta: async (): Promise<{ sessionDate: string; spots: Record<string, number>; updatedAt: string }> => ({
      sessionDate: "2026-10-26",
      spots: { SPY: 580, QQQ: 480, SPX: 5800 },
      updatedAt: "2026-10-26T14:00:00.000Z",
    }),
    shouldSeedSessionSpots: (): boolean => false,
    priorSpotsForBreaches: (): Record<string, number> => ({ SPY: 580, QQQ: 480, SPX: 5800 }),
    persistSpotSnapshotAfterTick: async (): Promise<Record<string, unknown>> => ({}),
    resetThermalBreachStateForSession: async (): Promise<void> => {},
    filterNewBreachAlerts: fakeFilterNewBreachAlerts,
    loadThermalBreachState: async (): Promise<FakeBreachState> => {
      const snapshot = breachStateStore;
      // Force a real async gap (like a real Redis round-trip) so two concurrent
      // runThermalBreachAlerts calls both read BEFORE either saves — the exact interleaving
      // that produces a lost update without the lock.
      await new Promise((r) => setTimeout(r, 10));
      return { ...snapshot };
    },
    saveThermalBreachState: async (state: FakeBreachState): Promise<void> => {
      breachStateStore = state;
    },
  },
});

async function loadModule() {
  return import("./thermal-discord-run.ts");
}

describe("thermal-discord-run concurrency (runThermalBreachAlerts)", () => {
  it("two concurrent calls detecting DIFFERENT crossings both land in saved state (no lost update)", async () => {
    const { runThermalBreachAlerts } = await loadModule();
    breachStateStore = {};
    lockHolder = null;
    webhookOutcomes = {};
    postedDedupKeys.length = 0;

    // Main 15m cron sees SPY's flip cross; the 5m poller, off its own slightly-later fetch,
    // sees QQQ's call-wall break — both land on the same scheduled minute.
    const spyFlip: FakeBreachEvent[] = [{ ticker: "SPY", kind: "flip", direction: "crossed_above" }];
    const qqqWall: FakeBreachEvent[] = [{ ticker: "QQQ", kind: "call_wall", direction: "crossed_above" }];

    const [resultA, resultB] = await Promise.all([
      runThermalBreachAlerts("https://discord.example/webhook", spyFlip as never),
      runThermalBreachAlerts("https://discord.example/webhook", qqqWall as never),
    ]);

    assert.equal(resultA.posted, 1, "the SPY-flip call must post its own alert");
    assert.equal(resultB.posted, 1, "the QQQ-wall call must post its own alert");

    assert.equal(
      breachStateStore.SPY?.flip,
      "above",
      "SPY's flip-cross state must be persisted — a lost update would drop it, causing a duplicate alert next tick",
    );
    assert.equal(
      breachStateStore.QQQ?.call_wall,
      "above",
      "QQQ's call-wall state must be persisted — a lost update would drop it, causing a duplicate alert next tick",
    );
  });

  it("many concurrent calls across distinct tickers all land in the final saved state", async () => {
    const { runThermalBreachAlerts } = await loadModule();
    breachStateStore = {};
    lockHolder = null;
    webhookOutcomes = {};
    postedDedupKeys.length = 0;

    const tickers = ["SPY", "QQQ", "SPX", "IWM", "NVDA"];
    const calls = tickers.map((ticker) =>
      runThermalBreachAlerts(
        "https://discord.example/webhook",
        [{ ticker, kind: "flip", direction: "crossed_above" }] as never,
      ),
    );
    await Promise.all(calls);

    for (const ticker of tickers) {
      assert.equal(
        breachStateStore[ticker]?.flip,
        "above",
        `expected ${ticker}'s flip-cross to be persisted — lost updates would drop some`,
      );
    }
  });

  it("a failed webhook post still does not claim the alert slot (pre-existing behavior preserved under the lock)", async () => {
    const { runThermalBreachAlerts } = await loadModule();
    breachStateStore = {};
    lockHolder = null;
    webhookOutcomes = { "thermal-breach-spy": false };
    postedDedupKeys.length = 0;

    const spyFlip: FakeBreachEvent[] = [{ ticker: "SPY", kind: "flip", direction: "crossed_above" }];
    const result = await runThermalBreachAlerts("https://discord.example/webhook", spyFlip as never);

    assert.equal(result.posted, 0, "a failed webhook must not count as posted");
    assert.equal(
      breachStateStore.SPY?.flip,
      undefined,
      "a failed webhook must not burn the alert slot — the next tick should retry it",
    );
  });
});
