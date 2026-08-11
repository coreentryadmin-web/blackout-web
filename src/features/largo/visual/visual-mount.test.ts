import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * VISUAL MOUNT WIRING.
 *
 * THE GAP THIS PINS, and it is one I shipped myself. `CreateVisualAction` was built, tested and
 * merged with ZERO references outside its own file — the API worked, the templates rendered, the
 * router routed, and there was no button anywhere in the product. Exactly the "real capability
 * with no path to the answering layer" pattern this codebase keeps paying for (helix-signal-
 * outcomes, Vector Pulse, the Helix derivations, the Vector analytics), committed while fixing
 * instances of it.
 *
 * A component is not shipped until something renders it, and nothing else in the suite can tell
 * the difference between "built" and "reachable".
 */

const ANSWER = "src/features/largo/components/LargoAnswerMessage.tsx";
const ACTION = "src/features/largo/visual/CreateVisualAction.tsx";

test("the action is MOUNTED on the answer, not merely built", () => {
  const src = readFileSync(ANSWER, "utf8");
  assert.ok(src.includes("CreateVisualAction"), "LargoAnswerMessage must render CreateVisualAction");
  assert.ok(src.includes("from \"@/features/largo/visual/CreateVisualAction\""), "and import it properly");
});

test("it is fed from the ENVELOPE, never from raw tool output", () => {
  const src = readFileSync(ANSWER, "utf8");
  // Raw `capturedResults` must not cross to the browser: it is unbounded untyped tool output.
  // Asserted on the PROP, not the token — the mount's own comment explains why it is omitted,
  // and a bare substring check fails on the explanation rather than on the behaviour.
  assert.ok(!/capturedResults\s*=\s*\{/.test(src), "raw tool results must not be passed as a prop");
  for (const prop of ["headline", "envelopeLevels", "envelopeGexShifts", "question"]) {
    assert.ok(src.includes(prop), `must pass ${prop} from the envelope`);
  }
});

test("the action is gated on a real envelope", () => {
  // Offering it on a raw-markdown fallback yields a button whose only outcome is
  // "no visual for this answer" — the evidence a card needs simply is not there.
  const src = readFileSync(ANSWER, "utf8");
  assert.match(src, /envelope\s*\?\s*\(/, "must render the slot only when an envelope exists");
});

test("the template picker is DERIVED from the server registry, not mirrored in the client", () => {
  // Same bug class as the mount gap above, one layer up. The picker was a hardcoded array of
  // three and stayed three when Screener, Rejection and EM-cone shipped — three working templates
  // nobody could ask for. A client-side copy of a server registry reproduces that by construction.
  const src = readFileSync(ACTION, "utf8");
  assert.ok(src.includes("plan?.available"), "chips must come from the plan response's `available`");
  assert.ok(
    !/id:\s*"(MARKET_MOVE|TRADE_RECAP|LEVEL_ANALYSIS|SCREENER)"/.test(src),
    "no template id may be hardcoded in the client — AUTO is the only literal",
  );
});

test("the rendered card is injected exactly once", () => {
  // It was injected twice: the same `dangerouslySetInnerHTML` block appeared inside the CTA row
  // AND below it, so every inline render drew two stacked copies of the card.
  const src = readFileSync(ACTION, "utf8");
  const injections = src.match(/dangerouslySetInnerHTML/g) ?? [];
  assert.equal(injections.length, 1, `card markup is injected ${injections.length} times`);
});

test("bias vocabulary is translated, and `mixed` never picks a side", () => {
  const src = readFileSync(ANSWER, "utf8");
  assert.ok(src.includes('"bullish" ? "bull"'), "BieBias → card bias mapping must be explicit");
  assert.ok(src.includes('"bearish" ? "bear"'), "and cover the bear side");
  // Everything else (neutral AND mixed) falls through to neutral rather than choosing.
  assert.ok(src.includes(': "neutral"'), "mixed must fall through to neutral, not a coin flip");
});

/**
 * AUTO-RENDER WIRING.
 *
 * The same "built but unreachable" class this file already pins one layer down. `detectVisualIntent`
 * and the server directive can both be perfect and the member still gets a button, because the
 * chain is four hops: intent -> runLargoQuery -> LargoAnswerMessage -> CreateVisualAction. Any one
 * of them dropping the prop reverts the behaviour to "we asked you to press something", and every
 * other test in the suite still passes.
 */

const TERMINAL = "src/lib/largo-terminal.ts";

test("the server emits an auto-render directive when the member asked for an image", () => {
  const src = readFileSync(TERMINAL, "utf8");
  assert.ok(src.includes("detectVisualIntent"), "the terminal must read visual intent");
  // BOTH transports. The streaming path is the one members actually use, and it is the easy one
  // to forget because the non-streaming return is what a reader looks at first.
  const emitted = src.match(/\.\.\.visualDirective\(question\)/g) ?? [];
  assert.equal(emitted.length, 2, `directive emitted on ${emitted.length} paths, expected both stream and non-stream`);
});

test("the directive REACHES the component — the whole point of it", () => {
  const answer = readFileSync(ANSWER, "utf8");
  assert.ok(answer.includes("autoVisual"), "the answer must accept the directive");
  assert.match(answer, /autoRender=\{autoVisual/, "and pass it to the visual action");

  const action = readFileSync(ACTION, "utf8");
  assert.ok(action.includes("autoRender"), "the action must accept it");
  assert.match(action, /autoFired/, "and fire without waiting for a click");
});

test("auto-render fires ONCE, not once per re-render", () => {
  // A render loop here would spend a satori render per tick against a premium-gated route. The
  // guard must be a ref, not state: a state flag re-triggers the effect it is meant to stop.
  const src = readFileSync(ACTION, "utf8");
  assert.match(src, /const autoFired = useRef\(false\)/, "the once-guard must survive re-renders");
  assert.match(src, /if \(!props\.autoRender \|\| autoFired\.current\) return/);
});

test("the auto-render uses the DIRECTIVE's size, not stale local state", () => {
  // `setSize` does not apply to the closure the same tick's render call captures, so a card
  // requested for a story would have been drawn at the landscape default.
  const src = readFileSync(ACTION, "utf8");
  assert.match(src, /void render\(\{ size: props\.autoRender\.size \}\)/);
  assert.match(src, /size: override\?\.size \?\? size/, "body() must honour the override");
});
