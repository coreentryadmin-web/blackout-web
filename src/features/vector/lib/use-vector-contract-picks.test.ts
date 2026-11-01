import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * Regression guard for a round-180 audit fix: `useVectorContractPicks`'s data-fetch effect had a
 * deliberately-stable derived key (`contextKey` — see `vectorContractPickFetchKey`, which uses
 * `sessionFlows.length` rather than identity and omits spot/technicals/walls/magnet/etc.
 * specifically so the debounce/periodic-refresh timers don't restart on every live tick) — but the
 * effect's OWN dependency array also listed the raw `emit`, `play` and `sessionFlows` references,
 * which get a new identity on every render where ANY field changes, including ones `contextKey`
 * leaves out on purpose. That tears the debounce timer and the "every ~45s" refresh interval down
 * and rebuilds them on every such tick, and can starve the initial debounced fetch outright if
 * updates arrive faster than `DEBOUNCE_MS`.
 *
 * There's no rendering harness in this repo (no renderHook/@testing-library — see
 * VectorScanner.test.ts's own note), so — matching that established pattern — this asserts the fix
 * is wired into the source: the fetch effect's dependency array must be driven by `contextKey`
 * alone (not the raw, noisier `emit`/`play`/`sessionFlows`), and `load()` must read fresh
 * emit/play/sessionFlows through refs instead of closing over them directly.
 */

const SRC_PATH = join(process.cwd(), "src/features/vector/lib/use-vector-contract-picks.ts");

function fetchEffectDeps(src: string): string[] {
  const idx = src.indexOf("useEffect(() => {");
  assert.ok(idx >= 0, "expected to find the single useEffect in use-vector-contract-picks.ts");
  const tail = src.slice(idx);
  const m = tail.match(/\n\s*\}, \[([^\]]*)\]\);/);
  assert.ok(m, "expected a `}, [...]);` dependency array closing the effect");
  return m![1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

test("useVectorContractPicks: fetch effect is driven by contextKey, not raw emit/play/sessionFlows", () => {
  const src = readFileSync(SRC_PATH, "utf8");
  const deps = fetchEffectDeps(src);

  assert.ok(
    deps.includes("contextKey"),
    "contextKey (the deliberately spot/sessionFlows-length-stable refetch signal) must drive the effect"
  );
  for (const noisy of ["emit", "play", "sessionFlows"]) {
    assert.ok(
      !deps.includes(noisy),
      `raw \`${noisy}\` must not be a direct effect dependency — it gets a new identity on every ` +
        "render where fields contextKey omits change, which restarts the debounce/45s-refresh " +
        "timers (and can starve the debounced fetch entirely) on top of contextKey's own signal"
    );
  }
});

test("useVectorContractPicks: load() reads emit/play/sessionFlows via refs so a periodic/debounced fetch sees fresh desk context without the effect itself restarting", () => {
  const src = readFileSync(SRC_PATH, "utf8");
  assert.match(src, /emitRef\.current = emit/, "emitRef must be kept current every render");
  assert.match(src, /playRef\.current = play/, "playRef must be kept current every render");
  assert.match(
    src,
    /sessionFlowsRef\.current = sessionFlows/,
    "sessionFlowsRef must be kept current every render"
  );
  // load() itself must read the refs, not the closed-over params, for the POST payload.
  const loadIdx = src.indexOf("const load = () => {");
  assert.ok(loadIdx >= 0, "expected a `load` function in the effect");
  const loadBody = src.slice(loadIdx, src.indexOf("const debounce = setTimeout", loadIdx));
  assert.match(loadBody, /emitRef\.current/, "load() must read emit through emitRef");
  assert.match(loadBody, /playRef\.current/, "load() must read play through playRef");
  assert.match(loadBody, /sessionFlowsRef\.current/, "load() must read sessionFlows through sessionFlowsRef");
});
