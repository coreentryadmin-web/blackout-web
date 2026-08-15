import assert from "node:assert/strict";
import test from "node:test";
import {
  filterVectorHelixFlows,
  flowAlertedMs,
  isFlowSinceSessionOpen,
  prepareVectorLiveHelixTape,
  trimVectorHelixFlowPool,
  VECTOR_HELIX_MIN_PREMIUM,
  VECTOR_HELIX_WHALE_PREMIUM,
  VECTOR_LIVE_HELIX_TAPE_CAP,
  vectorLiveHelixSubtitle,
} from "./vector-helix-flows";
import type { FlowAlert } from "@/lib/api";
import { sessionOpenMs } from "@/lib/largo/temporal/timeframe";

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

const midday = Date.parse("2026-08-15T14:00:00-04:00");
const sessionOpen = sessionOpenMs(midday);

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

test("isFlowSinceSessionOpen: rejects pre-open prints", () => {
  const preOpen = flow({ premium: 500_000, alerted_at: "2026-08-15T13:00:00Z" });
  const afterOpen = flow({ premium: 500_000, alerted_at: "2026-08-15T14:00:00Z" });
  assert.equal(isFlowSinceSessionOpen(preOpen, sessionOpen), false);
  assert.equal(isFlowSinceSessionOpen(afterOpen, sessionOpen), true);
});

test("prepareVectorLiveHelixTape: newest-first live ordering", () => {
  const rows = [
    flow({ premium: 250_000, alerted_at: "2026-08-15T14:10:00Z", strike: 901 }),
    flow({ premium: 800_000, alerted_at: "2026-08-15T14:55:00Z", strike: 902 }),
    flow({ premium: 500_000, alerted_at: "2026-08-15T14:30:00Z", strike: 903 }),
  ];
  const tape = prepareVectorLiveHelixTape(rows, defaultFilters);
  assert.equal(tape[0]!.strike, 902);
  assert.equal(tape[1]!.strike, 903);
  assert.equal(tape[2]!.strike, 901);
});

test("prepareVectorLiveHelixTape: thin tickers surface without major floor", () => {
  const asts = Array.from({ length: 4 }, (_, i) =>
    flow({
      ticker: "ASTS",
      premium: 210_000 + i * 15_000,
      strike: 20 + i,
      alerted_at: `2026-08-15T14:${String(10 + i).padStart(2, "0")}:00Z`,
    })
  );
  const tape = prepareVectorLiveHelixTape(asts, defaultFilters);
  assert.equal(tape.length, 4);
  assert.ok(tape.every((r) => r.premium >= VECTOR_HELIX_MIN_PREMIUM));
});

test("vectorLiveHelixSubtitle: honest empty live state", () => {
  assert.match(vectorLiveHelixSubtitle(0, true), /prints appear as they hit/i);
  assert.match(vectorLiveHelixSubtitle(0, false), /session closed/i);
  assert.match(vectorLiveHelixSubtitle(3, true), /3 prints today/i);
});

test("trimVectorHelixFlowPool: keeps newest cap for live tape", () => {
  const rows = [
    flow({ premium: 100_000, alerted_at: "2026-08-15T14:00:00Z" }),
    flow({ premium: 5_000_000, alerted_at: "2026-08-15T14:30:00Z" }),
    flow({ premium: 2_000_000, alerted_at: "2026-08-15T14:45:00Z" }),
  ];
  const trimmed = trimVectorHelixFlowPool(rows, 2);
  assert.equal(trimmed.length, 2);
  assert.equal(flowAlertedMs(trimmed[0]!), flowAlertedMs(rows[2]!));
  assert.equal(flowAlertedMs(trimmed[1]!), flowAlertedMs(rows[1]!));
});

test("prepareVectorLiveHelixTape: respects tape cap", () => {
  const rows = Array.from({ length: VECTOR_LIVE_HELIX_TAPE_CAP + 5 }, (_, i) =>
    flow({
      premium: 300_000 + i * 10_000,
      strike: 900 + i,
      alerted_at: `2026-08-15T14:${String(i).padStart(2, "0")}:00Z`,
    })
  );
  assert.equal(prepareVectorLiveHelixTape(rows, defaultFilters).length, VECTOR_LIVE_HELIX_TAPE_CAP);
});
