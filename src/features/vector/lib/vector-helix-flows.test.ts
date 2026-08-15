import assert from "node:assert/strict";
import test from "node:test";
import {
  filterVectorHelixFlows,
  pickVectorHelixMajorFlows,
  trimVectorHelixFlowPool,
  VECTOR_HELIX_MAJOR_MIN_PREMIUM,
  VECTOR_HELIX_MAJOR_TOP_N,
  VECTOR_HELIX_WHALE_PREMIUM,
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
  minPremium: VECTOR_HELIX_MAJOR_MIN_PREMIUM,
};

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

test("pickVectorHelixMajorFlows: top N by premium with major floor", () => {
  const rows = Array.from({ length: 20 }, (_, i) =>
    flow({ premium: 400_000 + i * 50_000, strike: 900 + i, alerted_at: `2026-08-15T14:${String(i).padStart(2, "0")}:00Z` })
  );
  const top = pickVectorHelixMajorFlows(rows, defaultFilters);
  assert.equal(top.length, VECTOR_HELIX_MAJOR_TOP_N);
  assert.ok(top[0]!.premium >= top[top.length - 1]!.premium);
  assert.ok(top.every((r) => r.premium >= VECTOR_HELIX_MAJOR_MIN_PREMIUM));
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
