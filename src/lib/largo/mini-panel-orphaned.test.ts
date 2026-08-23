import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * THE MINI-PANEL IS UNMOUNTED, AND THE DOCS SAID OTHERWISE FOR MONTHS.
 *
 * #2358 added `LargoDeskMiniPanel` and mounted it. #2387 — *"human-readable Concrete answers + drop
 * the two side panels"* — removed the mount and left behind the component AND its premium-gated
 * route `/api/market/largo/mini-panel`, which is still live and has no caller.
 *
 * Nothing noticed, because nothing could: an unmounted component does not fail, and a route with no
 * caller returns 200 to the nobody asking. The lane charter went on describing "mini-panels embedded
 * on other product pages" as a current member surface, and a Largo session reading it would go
 * looking for a UI that has not existed since #2387.
 *
 * WHAT THIS TEST IS FOR — and what it is deliberately NOT for. Deleting the component and the route
 * is a PRODUCT call (they may be staged for a re-mount), so this lane flags rather than actions it.
 * What the test pins is the thing that actually rotted: **the documented state and the real state
 * agreeing**. If someone re-mounts the panel, this test fails and the docs must be updated with it.
 * That is the intended direction — it is a tripwire on the doc/code gap, not a ban on the feature.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "..");

/** Every .tsx under src/, so "nothing mounts it" is a measured claim rather than a remembered one. */
function allTsx(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) allTsx(full, out);
    else if (name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

const MOUNTERS = allTsx(SRC).filter((f) => {
  if (f.endsWith("LargoDeskMiniPanel.tsx")) return false; // its own definition
  return /\bLargoDeskMiniPanel\b/.test(readFileSync(f, "utf8"));
});

test("the documented member surface matches the mounted one", () => {
  // Keyed on the CORRECTED assertion, not on the phrase it replaced. The first draft searched for
  // "plus mini-panels embedded on other product pages" — which the corrected row quotes verbatim in
  // order to explain what changed, so the test matched its own explanation and failed. Same shape as
  // the two comment-vs-assertion traps already hit in this lane: an assertion must not be satisfiable
  // by the prose that documents it.
  const charter = readFileSync(join(SRC, "..", "docs", "agents", "briefs", "largo.md"), "utf8");
  const documentsTerminalOnly = /That is the whole member surface/.test(charter);
  const isMounted = MOUNTERS.length > 0;
  assert.equal(
    documentsTerminalOnly,
    !isMounted,
    isMounted
      ? `LargoDeskMiniPanel is mounted again (${MOUNTERS.join(", ")}) — the charter still says /terminal is the whole member surface`
      : "nothing mounts LargoDeskMiniPanel, so the charter must say /terminal is the whole member surface"
  );
});

test("LargoDeskMiniPanel is currently mounted by nothing — measured, not remembered", () => {
  assert.deepEqual(
    MOUNTERS.map((f) => f.replace(SRC, "src")),
    [],
    "if this fails the panel was re-mounted; update the charter and the map's L-11 in the same change"
  );
});
