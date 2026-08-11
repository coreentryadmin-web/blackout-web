import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

/**
 * THE MANIFEST MUST DESCRIBE THE IMAGE — a source-level tripwire.
 *
 * FOUND BY RENDERING A LIVE PRODUCTION CARD AND READING ITS MANIFEST. Every card this library had
 * ever produced shipped with an EMPTY audit trail. `<PlaybookCard ... />` CREATES a React element;
 * it does not INVOKE the function. The body — where every `recorder.value(...)` call lives — runs
 * later, inside satori, so `buildManifest` always read a recorder nothing had written to. The
 * comment that used to sit beside it asserted the exact opposite.
 *
 * A card carrying real numbers with an empty manifest is the worst combination for the one surface
 * nobody can fact-check: the graphic travels, and the provenance record that exists to make it
 * verifiable says nothing was drawn. It is invisible in the PNG — the card looks perfect.
 *
 * WHY THIS IS A SOURCE ASSERTION rather than a render assertion: `render.tsx` is `server-only` and
 * cannot be imported from a test, the same constraint `visual-mount.test.ts` works under. It is
 * also the better guard — it fails on RE-INTRODUCTION of the pattern anywhere, not on one symptom
 * in one template.
 *
 * Measured before/after on the same bundle: COMPOSED 0 -> 6 recorded values, LEVEL_ANALYSIS 0 -> 4,
 * MARKET_MOVE 0 -> 5.
 */

const RENDER = "src/lib/largo/visual/render.tsx";
const TEMPLATE_DIR = "src/lib/largo/visual/templates";

/** Primitives that WRITE to the recorder. Instantiating one as JSX loses everything it would record. */
const RECORDING_PRIMITIVES = ["LevelMap", "HeroNumber", "MetricRow", "MetricTile", "SystemStrip", "GexBars", "PnlBlock", "Timeline"];

test("templates are CALLED, never instantiated as JSX, so their bodies run before the manifest is read", () => {
  const src = readFileSync(RENDER, "utf8");
  const jsxInstantiations = src.match(/element = \(?\s*<[A-Z]\w+/g) ?? [];
  assert.deepEqual(
    jsxInstantiations,
    [],
    `render.tsx instantiates ${jsxInstantiations.length} template(s) as JSX — their recorder.value() calls will not run before buildManifest reads the recorder`,
  );
  // And the calls are actually there, so this cannot pass by the templates having been deleted.
  assert.ok((src.match(/element = [A-Z]\w+\(\{/g) ?? []).length >= 15, "every template must be invoked directly");
});

test("recording PRIMITIVES are called too — the bug reaches one level down", () => {
  // The first fix converted only the top-level templates. COMPOSED then recorded exactly ONE value
  // (its regime, written inline in the switch) while the level map, hero and metric rail — all
  // JSX children — still recorded nothing.
  const offenders: string[] = [];
  for (const f of readdirSync(TEMPLATE_DIR).filter((x) => x.endsWith(".tsx"))) {
    const src = readFileSync(`${TEMPLATE_DIR}/${f}`, "utf8");
    for (const p of RECORDING_PRIMITIVES) {
      if (new RegExp(`<${p}[\\s/>]`).test(src)) offenders.push(`${f}:${p}`);
    }
  }
  assert.deepEqual(offenders, [], `recording primitives instantiated as JSX (their values never reach the manifest): ${offenders.join(", ")}`);
});

test("the corrected reasoning is recorded where the bug was", () => {
  // The original comment asserted "the recorder is populated during element construction, not
  // before it", which is what let the bug survive review — element construction does not run the
  // component. The replacement explains why every template is now called.
  //
  // Deliberately NOT a doesNotMatch on the old wording: the new comment QUOTES it, because a
  // reader needs to know what the previous claim was to understand why the code looks unusual.
  // An assertion that the old string is absent would fail on its own documentation.
  const src = readFileSync(RENDER, "utf8");
  assert.match(src, /AFTER THE COMPONENT BODY HAS RUN/);
  assert.match(src, /creates a React element; it does not invoke the function/i);
});
