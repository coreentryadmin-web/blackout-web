import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * LARGO'S OWN SURFACE MUST NOT ASSERT A LIVENESS IT DOES NOT MEASURE.
 *
 * `/terminal` rendered `<Badge tone="accent" dot>AI Online</Badge>` — a hardcoded literal with no
 * prop, no state and no health read behind it. It could not be false. It would have rendered green
 * with the Anthropic key removed entirely.
 *
 * MEASURED ON PRODUCTION 2026-08-23, both viewports (1440x900 and 430x932, via proxy-browser.cjs,
 * `Routed: 108 ok, 0 fail` / `102 ok, 0 fail`): "AI ONLINE" lit and green while EVERY Largo turn was
 * failing at round 0 with an HTTP 400 *"Your credit balance is too low to access the Anthropic
 * API"*. During the single event the badge exists to communicate, it said the opposite of the truth.
 *
 * The status endpoint rendered immediately BELOW that header had already written the rule down:
 *
 *   "a row of dots that are green because they are hard-coded green says the opposite the first
 *    time a member sees one lit during an outage"   — app/api/market/largo/status/route.ts
 *
 * It honours that for all six PRODUCT dots, each derived from that system's own production reader.
 * The AI's own dot was the one exception, sitting one component higher.
 *
 * WHY A SOURCE ASSERTION rather than a render test: `LargoPageShell` is a client component whose
 * body runs `useIosNativeShell`/`useFullscreen`, so SSR-rendering it here would exercise the hooks
 * rather than the claim. What must be pinned is textual and structural — that no unmeasured liveness
 * word is hardcoded into this shell — and that is exactly what a source assertion can hold.
 *
 * This guard permits a REAL signal: a badge fed from a prop, state or a fetched status is not a
 * hardcoded claim and does not match. It forbids only the literal form that shipped.
 */

const SHELL = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "LargoPageShell.tsx"),
  "utf8"
);

/** JSX text content, stripped of the comments that explain why the claim was removed. */
const CODE = SHELL.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

test("the shell hardcodes no AI liveness claim", () => {
  assert.doesNotMatch(
    CODE,
    /AI\s+Online/i,
    "a hardcoded 'AI Online' cannot be false — it carries no information and misinforms during an outage"
  );
});

test("no hardcoded liveness word is rendered as a status badge in this shell", () => {
  // The defect class, not just the one string: any of these words baked into JSX text asserts a
  // state this component does not read. A badge driven by a prop/state/fetch is untouched by this.
  for (const word of [/>\s*AI\s+Online\s*</i, /badge=\{[\s\S]{0,200}?\bOnline\b/i, /badge=\{[\s\S]{0,200}?\bHealthy\b/i]) {
    assert.doesNotMatch(CODE, word, `hardcoded liveness claim in the page header: ${word}`);
  }
});

test("the removal is explained in place, so it is not silently re-added", () => {
  // The comment is the durable part: without it the next person adds the badge back because a
  // header with no badge looks unfinished. It must name the measurement that is missing.
  assert.match(SHELL, /NO STATUS BADGE HERE, DELIBERATELY/);
  assert.match(SHELL, /credit balance/i, "must record what was live-wrong when this was found");
  assert.match(SHELL, /OMITTED, never fabricated/i, "must name the contract rule it follows");
});

test("the real status strip is untouched — this removes a false claim, not the true one", () => {
  // LargoTerminal renders the derived LIVE/CLOSED + N/6-systems strip from /api/market/largo/status.
  // Removing the fabricated header badge must not have taken the real signal with it.
  assert.match(SHELL, /<LargoTerminal/, "the terminal, which renders the derived status strip, still mounts");
});
