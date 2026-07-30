import { test } from "node:test";
import assert from "node:assert/strict";
import { occSymbolFromSwingRow, occFromChainContract } from "./occ-from-row";

test("occSymbolFromSwingRow: prefers stored OCC and normalizes O: prefix", () => {
  assert.equal(
    occSymbolFromSwingRow({ contract_occ: "NVDA260815C00150000" }),
    "O:NVDA260815C00150000",
  );
  assert.equal(
    occSymbolFromSwingRow({ contract_occ: "O:NVDA260815C00150000" }),
    "O:NVDA260815C00150000",
  );
});

test("occSymbolFromSwingRow: fail-closed when OCC missing — never reconstruct from strike columns", () => {
  assert.equal(
    occSymbolFromSwingRow({
      contract_occ: null,
      ticker: "NVDA",
      contract_expiry: "2026-08-15",
      contract_type: "call",
      contract_strike: 150,
    }),
    null,
  );
  assert.equal(occSymbolFromSwingRow({ ticker: "NVDA", contract_expiry: "2026-08-15" }), null);
  assert.equal(occSymbolFromSwingRow({}), null);
});

test("occFromChainContract: bare OCC for ledger at commit time (no O: prefix)", () => {
  assert.equal(
    occFromChainContract({ ticker: "NVDA", expiry: "2026-08-15", right: "C", strike: 150 }),
    "NVDA260815C00150000",
  );
});
