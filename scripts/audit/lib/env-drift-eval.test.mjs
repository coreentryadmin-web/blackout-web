import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyKey,
  equivalent,
  summarize,
  isSecretish,
  displayValue,
} from "./env-drift-eval.mjs";

test("equivalent: flag spellings and numeric forms are the same value", () => {
  // `5_000` is how this repo writes numeric defaults; without separator-stripping the scan
  // manufactures a phantom override against a deployed "5000".
  for (const [a, b] of [["1", "true"], ["0", "false"], ["30", "30"], ["30", "30.0"], ["", "false"], ["5000", "5_000"]]) {
    assert.equal(equivalent(a, b), true, `${a} ~ ${b}`);
  }
  for (const [a, b] of [["1", "0"], ["30", "20"], ["spy_proxy", "native"]]) {
    assert.equal(equivalent(a, b), false, `${a} !~ ${b}`);
  }
});

test("classifyKey: unset means the code default governs — the safe, common case", () => {
  const r = classifyKey({ name: "SPX_CHAIN_MIN_OI", deployed: undefined, codeDefault: "100" });
  assert.equal(r.verdict, "unset");
});

test("classifyKey: a value equal to the default is a no-op, not an override", () => {
  // ENGINE_INTEL_OVERLAY is literally "0" in production against a default of false. Calling that
  // an override would bury the real ones in noise.
  const r = classifyKey({ name: "ENGINE_INTEL_OVERLAY", deployed: "0", codeDefault: "false" });
  assert.equal(r.verdict, "no-op");
});

test("classifyKey: a value the code would not have chosen is an override — the decoy case", () => {
  const r = classifyKey({ name: "SPX_DESK_CACHE_SEC", deployed: "30", codeDefault: "20" });
  assert.equal(r.verdict, "override");
  assert.equal(r.deployed, "30");
  assert.equal(r.codeDefault, "20");
});

test("classifyKey: no known default reports unknown rather than guessing one", () => {
  const r = classifyKey({ name: "SOME_NEW_KNOB", deployed: "7", codeDefault: null });
  assert.equal(r.verdict, "unknown");
});

test("secrets are redacted by NAME, so a short secret cannot slip through on length", () => {
  assert.equal(isSecretish("POLYGON_API_KEY"), true);
  assert.equal(isSecretish("DATABASE_URL"), true);
  assert.equal(isSecretish("SPX_DESK_CACHE_SEC"), false);
  assert.match(displayValue("POLYGON_API_KEY", "x"), /redacted/);
  assert.equal(displayValue("SPX_DESK_CACHE_SEC", "30"), '"30"');
});

test("summarize: counts and carries the rows a reader must act on", () => {
  const s = summarize([
    classifyKey({ name: "A", deployed: undefined, codeDefault: "1" }),
    classifyKey({ name: "B", deployed: "0", codeDefault: "false" }),
    classifyKey({ name: "C", deployed: "30", codeDefault: "20" }),
    classifyKey({ name: "D", deployed: "7", codeDefault: null }),
  ]);
  assert.deepEqual(
    { total: s.total, unset: s.unset, no_op: s.no_op, override: s.override, unknown: s.unknown },
    { total: 4, unset: 1, no_op: 1, override: 1, unknown: 1 }
  );
  assert.equal(s.overrides[0].name, "C", "the override rows are what a reader acts on");
});
