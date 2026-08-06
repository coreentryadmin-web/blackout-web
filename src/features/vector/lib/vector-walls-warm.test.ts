import { before, test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";

mock.module("server-only", { namedExports: {} });

mock.module("./vector-stream-hub", {
  namedExports: {
    getActiveVectorTickers: () => ["LIVE1"],
  },
});

mock.module("./vector-snapshot", {
  namedExports: {
    getVectorGexWalls: () => null,
    getVectorVexWalls: () => null,
    recordVectorWallSamplesFromWarm: async () => true,
  },
});

mock.module("./vector-dynamic-universe", {
  namedExports: {
    listDynamicUniverseTickers: async () => ["NVDA", "AAPL"],
    mergeSharedUniverseTickers: (staticList: string[], dynamicList: string[]) => {
      const out: string[] = [];
      const seen = new Set<string>();
      for (const raw of [...staticList, ...dynamicList]) {
        const t = String(raw ?? "").trim().toUpperCase();
        if (!t || seen.has(t)) continue;
        seen.add(t);
        out.push(t);
      }
      return out;
    },
  },
});

let getTickersToWarm: typeof import("./vector-walls-warm").getTickersToWarm;

before(async () => {
  const mod = await import("./vector-walls-warm");
  getTickersToWarm = mod.getTickersToWarm;
});

test("getTickersToWarm: allowlist ∪ dynamic ∪ live viewers, deduped", () => {
  assert.deepEqual(getTickersToWarm(["SPY", "SPX"], ["NVDA", "SPY"], ["LIVE1", "NVDA"]), [
    "SPY",
    "SPX",
    "NVDA",
    "LIVE1",
  ]);
});

test("getTickersToWarm: defaults dynamic empty; still unions live viewers", () => {
  assert.deepEqual(getTickersToWarm(["QQQ"]), ["QQQ", "LIVE1"]);
});
