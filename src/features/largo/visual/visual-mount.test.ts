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
  assert.ok(src.includes('from "@/features/largo/visual/CreateVisualAction"'), "and import it properly");
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

test("the action is gated on real EVIDENCE — an envelope OR a replayable turn", () => {
  // THIS ASSERTION USED TO READ `envelope ? (`, and it was pinning a stale premise rather than a
  // behaviour. It was written when the card was drawn from the envelope's own levels/gexShifts, so
  // "no envelope" really did mean "nothing to draw". Once the composer began rebuilding from the
  // TURN's stored tool results, the envelope stopped being the source of evidence and became a
  // parser artefact — `envelopeFromContract` returns null whenever the model's reply drifts off the
  // section contract, on turns whose tool results are perfectly intact.
  //
  // Measured cost: a live probe asked for an image of tomorrow's NH plays and of today's 0DTE
  // results. Both persisted fine, both set the auto-render directive, and on both the slot was
  // never mounted — so the component that acts on the directive did not exist to act on it.
  //
  // The gate is loosened, NOT removed: an answer with neither an envelope nor a turn still offers
  // nothing, which is the case the original test was right about.
  const src = readFileSync(ANSWER, "utf8");
  assert.match(
    src,
    /envelope \|\| turnId != null \? \(/,
    "the slot must render when EITHER an envelope or a replayable turn is present",
  );
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

/**
 * THE TURN ID'S FULL JOURNEY — five hops, and it was broken at four of them.
 *
 * The card is rebuilt server-side from a persisted turn, so `turn_id` is the single field that
 * decides whether a card can be drawn from real evidence at all. It has to survive:
 *
 *   largo-terminal (emit) -> SSE `done` -> api.ts (parse) -> useLargoChat (store)
 *     -> LargoTerminal / LargoNativeTerminal (pass) -> LargoAnswerMessage -> CreateVisualAction
 *
 * Measured live 2026-08-11, every hop but the first was dropping something:
 *   1. the terminal carried the id ONLY on `envelope.turnId`, so a non-conforming answer lost it;
 *   2. api.ts's stream parser never copied `ticker`/`visual`/`turn_id` out of the `done` event —
 *      the outer signature PROMISED `ticker` and the parser had never returned it, which is why
 *      the contextual rail never followed the instrument Largo resolved either;
 *   3. the chat hook stored neither on the message;
 *   4. neither terminal passed `autoVisual` — the prop was declared, documented, and handed to
 *      nobody.
 *
 * None of it could fail a type check: a missing optional property is assignable, so every hop
 * compiled and the field simply evaporated. That is what these assertions exist for. They are
 * per-hop on purpose — a single end-to-end assertion would say "broken" without saying where.
 */

const API = "src/lib/api.ts";
const HOOK = "src/hooks/useLargoChat.ts";
const DESK = "src/features/largo/components/LargoTerminal.tsx";
const NATIVE = "src/features/largo/components/LargoNativeTerminal.tsx";

test("hop 1 — the terminal emits turn_id TOP-LEVEL on both transports", () => {
  const src = readFileSync(TERMINAL, "utf8");
  const emitted = src.match(/turn_id: turnId \?\? null/g) ?? [];
  assert.equal(emitted.length, 2, `turn_id emitted on ${emitted.length} paths, expected stream and non-stream`);
  // The id must not depend on the envelope parsing: that coupling IS the bug.
  assert.ok(
    !/envelope\s*&&\s*turnId != null\s*\)\s*return/.test(src),
    "turn_id must not be conditional on a parsed envelope",
  );
});

test("hop 2 — the stream parser copies every field the signature promises", () => {
  const src = readFileSync(API, "utf8");
  for (const field of ["ticker: event.ticker", "turn_id: event.turn_id", "visual: event.visual"]) {
    assert.ok(src.includes(field), `the done handler must copy ${field.split(":")[0]}`);
  }
  // The shape is declared ONCE and reused for both the accumulator and the event, so a field can
  // no longer be promised by one and absent from the other.
  assert.match(src, /type LargoDone = \{/, "the done shape must be named, not duplicated inline");
  assert.match(src, /JSON\.parse\(payload\) as Partial<LargoDone>/, "the event must be typed off it");
});

test("hop 3 — the chat hook stores the turn and the directive on the MESSAGE", () => {
  const src = readFileSync(HOOK, "utf8");
  assert.match(src, /turnId: res\.turn_id \?\? null/, "the turn id must be stored");
  assert.match(src, /visual: res\.visual \? \{ size: res\.visual\.size \} : null/, "and the directive");
  // Per-message, not a single "latest turn" slot: a card action on an older answer must rebuild
  // that answer's turn, not whichever one arrived last.
  assert.match(src, /turnId\?: number \| null/, "the message type must carry it");
});

test("hop 4 — BOTH terminals pass the turn and the directive down", () => {
  for (const [name, path] of [
    ["desk", DESK],
    ["native", NATIVE],
  ] as const) {
    const src = readFileSync(path, "utf8");
    assert.match(src, /turnId=\{msg\.turnId \?\? null\}/, `${name} terminal must pass the turn id`);
    assert.match(src, /autoVisual=\{msg\.visual \?\? null\}/, `${name} terminal must pass the directive`);
  }
});

test("hop 5 — the answer prefers the top-level id but still honours the old envelope shape", () => {
  const src = readFileSync(ANSWER, "utf8");
  assert.match(
    src,
    /turnId=\{turnId \?\? envelope\?\.turnId \?\? null\}/,
    "a message rehydrated from before the top-level field shipped must still resolve its turn",
  );
  // The envelope is now optional at this call site; reading it unguarded would throw on exactly
  // the turns this fix exists to serve.
  //
  // SCOPED TO THE SLOT, not the file. The `rich` branch above reads `envelope.headline` unguarded
  // and is right to — it sits inside an `if (envelope)` that narrows the type. A file-wide check
  // fails on that correct code, which is a test reporting a bug where there is none.
  const slot = src.slice(src.indexOf("<CreateVisualAction"), src.indexOf("</div>", src.indexOf("<CreateVisualAction")));
  assert.ok(slot.length > 0, "the visual slot must be locatable");
  for (const field of ["headline", "levels", "bias", "gexShifts"]) {
    assert.ok(
      !new RegExp(`\\benvelope\\.${field}\\b`).test(slot),
      `envelope.${field} in the visual slot must be optional-chained`,
    );
  }
});
