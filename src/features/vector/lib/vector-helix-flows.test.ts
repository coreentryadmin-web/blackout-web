import assert from "node:assert/strict";
import test from "node:test";
import {
  filterVectorHelixFlows,
  pickVectorHelixSessionFlows,
  trimVectorHelixFlowPool,
  VECTOR_HELIX_HOT_TOP_N,
  VECTOR_HELIX_MIN_PREMIUM,
  VECTOR_HELIX_SESSION_TOP_N,
  VECTOR_HELIX_WHALE_PREMIUM,
  vectorHelixSessionSubtitle,
} from "./vector-helix-flows";
import type { FlowAlert } from "@/lib/api";

function flow(partial: Partial<FlowAlert> & Pick<FlowAlert, "premium">): FlowAlert {
  return {
    ticker: "NVDA",
    premium: partial.premium,
    option_type: partial.option_type ?? "CALL",
    expiry: partial.expiry ?? "2026-08-15",
    strike: partial.strike ?? 900,
    direction: "BUY",
    score: partial.score ?? 7,
    route: "whale",
    alerted_at: partial.alerted_at ?? "2026-08-15T14:00:00Z",
    ...partial,
  };
}

const defaultFilters = {
  typeFilter: "ALL" as const,
  whalesOnly: false,
  dteOnly: false,
  minPremium: VECTOR_HELIX_MIN_PREMIUM,
};

const sessionNow = new Date("2026-08-15T15:00:00Z");

test("filterVectorHelixFlows: whales + side + 0DTE", () => {
  const rows = [
    flow({ premium: 1_500_000, option_type: "CALL", dte: 0 }),
    flow({ premium: 900_000, option_type: "PUT", dte: 0 }),
    flow({ premium: 2_000_000, option_type: "CALL", dte: 5 }),
  ];
  const whales = filterVectorHelixFlows(rows, {
    typeFilter: "ALL",
    whalesOnly: true,
    dteOnly: false,
    minPremium: 200_000,
  });
  assert.equal(whales.length, 2);
  assert.ok(whales.every((r) => r.premium >= VECTOR_HELIX_WHALE_PREMIUM));

  const dte0 = filterVectorHelixFlows(rows, {
    typeFilter: "ALL",
    whalesOnly: false,
    dteOnly: true,
    minPremium: 200_000,
  });
  assert.equal(dte0.length, 2);
});

test("pickVectorHelixSessionFlows: hot lane surfaces recent prints by premium", () => {
  const rows = [
    flow({ premium: 250_000, alerted_at: "2026-08-15T14:55:00Z", strike: 901 }),
    flow({ premium: 800_000, alerted_at: "2026-08-15T14:50:00Z", strike: 902 }),
    flow({ premium: 5_000_000, alerted_at: "2026-08-15T10:00:00Z", strike: 903 }),
  ];
  const pick = pickVectorHelixSessionFlows(rows, defaultFilters, { now: sessionNow });
  assert.equal(pick.hotNow.length, 2);
  assert.equal(pick.hotNow[0]!.premium, 800_000);
  assert.equal(pick.sessionLeaders.length, 1);
  assert.equal(pick.sessionLeaders[0]!.premium, 5_000_000);
});

test("pickVectorHelixSessionFlows: thin tickers rank session leaders without major floor", () => {
  const asts = Array.from({ length: 8 }, (_, i) =>
    flow({
      ticker: "ASTS",
      premium: 210_000 + i * 15_000,
      strike: 20 + i,
      alerted_at: `2026-08-15T08:${String(i).padStart(2, "0")}:00Z`,
    })
  );
  const pick = pickVectorHelixSessionFlows(asts, defaultFilters, { now: sessionNow });
  assert.equal(pick.hotNow.length, 0);
  assert.equal(pick.sessionLeaders.length, 8);
  assert.ok(pick.sessionLeaders.every((r) => r.premium >= VECTOR_HELIX_MIN_PREMIUM));
  assert.match(vectorHelixSessionSubtitle(pick), /Top 12 by premium · session/);
});

test("pickVectorHelixSessionFlows: dedupes hot prints from session leaders", () => {
  const rows = Array.from({ length: 20 }, (_, i) =>
    flow({
      premium: 400_000 + i * 50_000,
      strike: 900 + i,
      alerted_at: `2026-08-15T14:${String(59 - i).padStart(2, "0")}:00Z`,
    })
  );
  const pick = pickVectorHelixSessionFlows(rows, defaultFilters, { now: sessionNow });
  assert.equal(pick.hotNow.length, VECTOR_HELIX_HOT_TOP_N);
  assert.equal(pick.sessionLeaders.length, VECTOR_HELIX_SESSION_TOP_N);
  const hotKeys = new Set(pick.hotNow.map((f) => `${f.strike}|${f.alerted_at}`));
  for (const leader of pick.sessionLeaders) {
    assert.ok(!hotKeys.has(`${leader.strike}|${leader.alerted_at}`));
  }
});

test("trimVectorHelixFlowPool: keeps premium-ranked cap", () => {
  const rows = [
    flow({ premium: 100_000 }),
    flow({ premium: 5_000_000 }),
    flow({ premium: 2_000_000 }),
  ];
  const trimmed = trimVectorHelixFlowPool(rows, 2);
  assert.equal(trimmed.length, 2);
  assert.equal(trimmed[0]!.premium, 5_000_000);
  assert.equal(trimmed[1]!.premium, 2_000_000);
});
