import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Every SPX submodule must prefetch ITS OWN subject, and its tool label must name what it fetched.
 *
 * FOUND IN THE LIVE TOOL TRACES of the 44-scenario prod audit, not by reading the code:
 *
 *   sub-gex-*         tools=… desk_prefetch_spx_gex          <- right
 *   sub-pin-concrete  tools=… desk_prefetch_spx_gex          <- pin fell through to GEX
 *   sub-technicals-*  tools=… desk_prefetch_spx_technicals   <- label right, PAYLOAD was GEX
 *
 * Two defects with the same shape. PIN shared the `gex` branch, so the one submodule whose whole
 * subject is the EOD magnet was handed a gamma summary. TECHNICALS was worse: it fetched the GEX
 * matrix, pushed it as `gex_summary`, and announced `desk_prefetch_spx_technicals` — so the model
 * got dealer positioning when it asked for EMA/VWAP, AND the trace claimed technicals had been
 * prefetched. That is why the routing matrix scored it correct and could never have caught it:
 * a mislabelled prefetch launders a wrong payload as a right one.
 *
 * These assertions are deliberately about the SUBJECT of each branch, not about which reader
 * function supplies it. Both defects were fixed concurrently and independently — with different
 * readers than the ones first proposed — so a test pinned to a specific import name would have
 * broken on a correct fix and taught the next person to loosen it.
 *
 * Asserted on source: this module reaches Postgres, Redis and several upstreams, so importing it
 * would mean standing up the world to observe a few payload keys.
 */

const SRC = readFileSync(join(process.cwd(), "src/lib/largo/desk-scope-prefetch.ts"), "utf8");

/** Strip comments so a guard never matches its own explanation. */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

/** The SPX case block only — other desks reuse the same submodule ids. */
const SPX_BLOCK = (() => {
  const start = CODE.indexOf('case "spx-slayer"');
  assert.notEqual(start, -1, "spx-slayer case not found");
  const end = CODE.indexOf('case "helix"', start);
  return CODE.slice(start, end === -1 ? undefined : end);
})();

/** Body of one `subId === "…"` branch, up to the next branch. */
function branchFor(id: string): string {
  const start = SPX_BLOCK.indexOf(`subId === "${id}"`);
  assert.notEqual(start, -1, `no SPX branch for subId "${id}"`);
  const rest = SPX_BLOCK.slice(start);
  const next = rest.indexOf("} else if (subId ===", 1);
  return next === -1 ? rest : rest.slice(0, next);
}

/** Every submodule id the SPX block actually branches on. */
const SPX_SUBS = [...new Set([...SPX_BLOCK.matchAll(/subId === "([a-z-]+)"/g)].map((m) => m[1]!))];

test("REGRESSION: pin prefetches a PIN source, not merely the GEX matrix", () => {
  const body = branchFor("pin");
  assert.match(body, /pin/i, "pin branch must fetch something pin-shaped");
  assert.match(body, /pin_forecast|pin:/, "payload must expose the pin read under its own key");
  assert.match(body, /desk_prefetch_spx_pin/, "label must name pin, not gex");
  // The precise shape of the original bug.
  assert.doesNotMatch(
    SPX_BLOCK,
    /subId === "gex"\s*\|\|\s*subId === "pin"/,
    "pin must not be OR-ed into the gex branch"
  );
});

test("REGRESSION: technicals prefetches TECHNICALS — the label must not outrun the payload", () => {
  const body = branchFor("technicals");
  // EMA/VWAP are the subject. Naming any of them proves a real technicals read, whichever
  // reader supplies it.
  assert.match(body, /vwap|ema20|ema50|ema200/i, "must fetch real technicals (EMA/VWAP)");
  assert.match(body, /desk_prefetch_spx_technicals/, "label was always correct — payload now matches it");
  // The bug: this branch's whole payload was the gamma matrix.
  const onlyGex = /gex_summary/.test(body) && !/vwap|ema/i.test(body);
  assert.equal(onlyGex, false, "technicals must not be a GEX payload wearing a technicals label");
});

test("every SPX submodule branch fetches something AND labels it", () => {
  // A branch that pushes nothing degrades to whatever the generic live feed happened to carry,
  // which reads to a member as "the desk has no view on this" rather than "nothing was fetched".
  assert.ok(SPX_SUBS.length >= 6, `expected the SPX block to branch on several submodules, saw ${SPX_SUBS.length}`);
  for (const id of SPX_SUBS) {
    const body = branchFor(id);
    assert.match(body, /toolsUsed\.push\(/, `${id}: must record a tool label`);
    assert.match(body, /chunks\.push\(/, `${id}: must push a payload`);
  }
});

test("tool labels stay distinct, so a fallthrough is visible in the trace", () => {
  // The prod audit grades routing off `tools=`. When two submodules report the SAME label, the
  // audit cannot distinguish a correct route from a fallthrough — exactly how the pin bug hid.
  // Deliberate shares are named here so an accidental one still fails.
  const INTENTIONAL_SHARES = [
    ["play", "gates"], // gates ARE the play engine's admission checks
    ["technicals", "internals"], // one desk-summary read, two slices of it
  ];
  const label = new Map<string, string>();
  for (const id of SPX_SUBS) {
    const m = branchFor(id).match(/toolsUsed\.push\("([^"]+)"\)/);
    assert.ok(m, `${id}: no tool label found`);
    label.set(id, m![1]!);
  }
  const shareGroup = new Map<string, string>();
  for (const group of INTENTIONAL_SHARES) for (const id of group) shareGroup.set(id, group[0]!);

  const seen = new Map<string, string>();
  for (const [id, lbl] of label) {
    const owner = shareGroup.get(id) ?? id;
    const prior = seen.get(lbl);
    if (prior && prior !== owner) {
      assert.fail(`submodules "${prior}" and "${owner}" share the tool label "${lbl}" without being declared an intentional share`);
    }
    seen.set(lbl, owner);
  }
});
