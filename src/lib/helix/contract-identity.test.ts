import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  contractSide,
  flowContractKey,
  flowContractKeyOrUnknown,
  sameFlowContract,
  strikeMills,
} from "./contract-identity";

const base = { ticker: "INTC", expiry: "2026-08-21", option_type: "PUT" };

test("the defect this file exists for: a half-dollar strike is NOT the strike above it", () => {
  // Measured live 2026-08-23: INTC 92.5P and INTC 93P both printed on the same expiry, and the old
  // Math.round(strike) key merged them.
  assert.notEqual(flowContractKey({ ...base, strike: 92.5 }), flowContractKey({ ...base, strike: 93 }));
  assert.equal(sameFlowContract({ ...base, strike: 92.5 }, { ...base, strike: 93 }), false);
  // ...and the other measured pairs.
  assert.notEqual(flowContractKey({ ...base, strike: 91.5 }), flowContractKey({ ...base, strike: 92 }));
  assert.notEqual(
    flowContractKey({ ticker: "QQQ", expiry: "2026-08-21", option_type: "CALL", strike: 712.5 }),
    flowContractKey({ ticker: "QQQ", expiry: "2026-08-21", option_type: "CALL", strike: 713 })
  );
});

test("float noise does NOT split one contract — the mirror-image bug the old rounding guarded", () => {
  // Upstream serves unrounded floats (CLAUDE.md records 7499.360000000001). Exact === would have
  // made this row its own contract; mills quantisation absorbs it.
  assert.equal(flowContractKey({ ...base, strike: 92.5 }), flowContractKey({ ...base, strike: 92.50000000000001 }));
  assert.equal(strikeMills(7499.360000000001), 7499360);
});

test("strike is quantised at mills — the precision OCC actually encodes", () => {
  assert.equal(strikeMills(92.5), 92500);
  assert.equal(strikeMills("110"), 110000);
  // 0 is not a tradeable strike — matching buildOccContractId's `strike <= 0` guard.
  assert.equal(strikeMills(0), null);
  assert.equal(strikeMills(-5), null);
  // Number(null) and Number("") are both 0, so these MUST be rejected before the finite check.
  assert.equal(strikeMills(null), null);
  assert.equal(strikeMills(undefined), null);
  assert.equal(strikeMills(""), null);
  assert.equal(strikeMills("   "), null);
  assert.equal(strikeMills("abc"), null);
});

test("ticker, expiry and side all participate — none may be dropped from the key", () => {
  const k = flowContractKey({ ...base, strike: 92.5 });
  assert.notEqual(k, flowContractKey({ ...base, ticker: "AMD", strike: 92.5 }));
  assert.notEqual(k, flowContractKey({ ...base, expiry: "2026-08-28", strike: 92.5 }));
  assert.notEqual(k, flowContractKey({ ...base, option_type: "CALL", strike: 92.5 }));
});

test("ticker case and US-format expiry normalize instead of splitting", () => {
  assert.equal(
    flowContractKey({ ...base, strike: 92.5 }),
    flowContractKey({ ticker: "intc", expiry: "8/21/2026", option_type: "put", strike: 92.5 })
  );
});

test("side collapses anything call-ish to C and everything else to P", () => {
  assert.equal(contractSide("CALL"), "C");
  assert.equal(contractSide("call"), "C");
  assert.equal(contractSide("C"), "C");
  assert.equal(contractSide("PUT"), "P");
  assert.equal(contractSide(null), "P");
});

test("an unusable strike returns null so a caller cannot group unrelated rows under NaN", () => {
  assert.equal(flowContractKey({ ...base, strike: null }), null);
  assert.equal(flowContractKey({ ...base, strike: "n/a" }), null);
  assert.equal(sameFlowContract({ ...base, strike: null }, { ...base, strike: null }), false);
});

test("the never-null variant still separates by ticker/expiry/side", () => {
  const a = flowContractKeyOrUnknown({ ...base, strike: null });
  assert.match(a, /nostrike/);
  assert.notEqual(a, flowContractKeyOrUnknown({ ...base, ticker: "AMD", strike: null }));
  assert.notEqual(a, flowContractKeyOrUnknown({ ...base, option_type: "CALL", strike: null }));
  assert.notEqual(a, flowContractKeyOrUnknown({ ...base, expiry: "2026-08-28", strike: null }));
});

test("RATCHET: no HELIX file quantises a strike to the nearest dollar for contract identity", () => {
  // Three files each did this independently and all three were wrong in the same way. A grep is the
  // only thing that stops a fourth appearing — a value test cannot see a copy it does not import.
  //
  // Deliberate exceptions carry `strike-rounding: intentional` on the line or in the comment
  // immediately above it, so
  // this is self-maintaining rather than an allowlist: a new copy that does not explain itself
  // fails, and an exception cannot go stale by omission because it lives on the line it excuses.
  let out = "";
  try {
    out = execFileSync(
      "git",
      ["grep", "-n", "-B2", "-E", "Math\\.round\\(.*strike", "--", "src/features/helix", "src/lib/helix", "src/lib/helix-*.ts"],
      { encoding: "utf8", cwd: process.cwd() }
    );
  } catch {
    return; // git grep exits 1 with no matches at all — nothing to police.
  }
  const offenders: string[] = [];
  const lines = out.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!/:\d+:.*Math\.round\(.*strike/.test(line)) continue; // context lines use `-`, not `:`
    if (line.includes(".test.ts")) continue;
    if (/strike\s*\*\s*1000/.test(line)) continue;            // mills — the CORRECT precision
    if (line.includes("strike-rounding: intentional")) continue;
    const above = `${lines[i - 1] ?? ""}\n${lines[i - 2] ?? ""}`;
    if (above.includes("strike-rounding: intentional")) continue;
    offenders.push(line);
  }
  assert.deepEqual(offenders, [], `dollar-quantised strike identity reintroduced:\n${offenders.join("\n")}`);
});
