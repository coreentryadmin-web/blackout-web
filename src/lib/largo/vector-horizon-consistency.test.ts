import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

// `fetchVectorFullState`'s own default horizon param is "0dte" (VECTOR_DEFAULT_DTE_HORIZON,
// vector-dte-horizon.ts — Vector's chart genuinely opens on 0DTE by product design). That
// default is CORRECT for a caller that specifically wants today's 0DTE-scoped walls/flip
// (full-platform-snapshot.ts, play-suggest-read.ts, the Cortex 0DTE gate, vector-pick-sweep).
// It is WRONG for a caller that wants the general/canonical picture — the same all-expiry
// wall/flip figures SPX Slayer and Thermal report by default — and silently omits the horizon
// arg, inheriting "0dte" by accident rather than by intent. That silent scope mismatch is
// exactly the risk flagged in review: Largo could see a different flip/wall for the same
// ticker depending on which of its own internal reads it happens to be looking at.
//
// Every site below feeds a general "what does Vector show" read (a health strip, a slash-
// prompt preview, a desk-scoped mini-panel, or Largo's own prefetched context) — none of them
// are 0DTE-specific — so each must pass "all" EXPLICITLY. This guards against a future edit
// re-introducing the implicit default by omitting the argument again.
const SITES: Array<{ file: string; label: string }> = [
  { file: "src/app/api/market/largo/status/route.ts", label: "Largo intelligence status strip" },
  { file: "src/lib/largo/slash-prompts.ts", label: "SPX Vector slash-prompt preview" },
  { file: "src/lib/largo/mini-panel.ts", label: "mini-panel (both SPX and per-ticker vector cases)" },
  { file: "src/lib/largo/desk-scope-prefetch.ts", label: "desk-scope prefetch (both SPX and per-ticker vector cases)" },
];

for (const { file, label } of SITES) {
  test(`${label} — fetchVectorFullState calls pass horizon explicitly`, () => {
    const src = readFileSync(join(root, file), "utf8");
    const calls = [...src.matchAll(/fetchVectorFullState\(([^)]*)\)/g)].map((m) => m[1]);
    assert.ok(calls.length > 0, `expected at least one fetchVectorFullState(...) call in ${file}`);
    for (const args of calls) {
      assert.match(
        args,
        /"all"/,
        `fetchVectorFullState(${args}) in ${file} omits an explicit "all" horizon — it will ` +
          `silently inherit the "0dte" default and can disagree with SPX Slayer/Thermal's ` +
          `canonical walls/flip for the same ticker`
      );
    }
  });
}
