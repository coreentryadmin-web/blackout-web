import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * TURN REPLAY — the security and correctness properties, asserted on the source.
 *
 * `fetchLargoTurnResults` and the route that calls it both talk to Postgres and Clerk, so a unit
 * test cannot execute them here (raw TCP to prod PG is blocked from this sandbox, and a mocked DB
 * would only assert that the mock behaves as written). What CAN be pinned without a database is
 * the shape of the guarantees — and these are exactly the ones whose absence would be a silent
 * IDOR rather than a visible failure, so pinning them is worth more than the usual source-shaped
 * test.
 */

const STORE = "src/lib/largo/largo-store.ts";
const ROUTE = "src/app/api/largo/visual/route.ts";

test("ownership is enforced IN THE QUERY, not by the caller", () => {
  const src = readFileSync(STORE, "utf8");
  const fn = src.slice(src.indexOf("export async function fetchLargoTurnResults"));
  // `largo_messages.id` is a sequential integer, so guessing another member's turn id is trivial.
  // A caller-side check would be one forgotten branch away from serving someone else's desk
  // history as a shareable graphic.
  assert.match(fn, /JOIN largo_sessions s ON s\.id = m\.session_id/, "must join to the session");
  assert.match(fn, /s\.user_id = \$2/, "must filter on the owning user in SQL");
  assert.match(fn, /m\.role = 'assistant'/, "only assistant turns carry results");
});

test("a missing, foreign, or non-assistant turn are INDISTINGUISHABLE", () => {
  const src = readFileSync(STORE, "utf8");
  // Sliced from the DOC COMMENT, not the declaration — the rationale lives above the function and
  // an earlier version of this test cut it off and failed on its own slice.
  const fn = src.slice(src.indexOf("ONE turn's persisted tool results"));
  // One `return null` for every rejection path: distinct errors would turn the endpoint into an
  // oracle for which turn ids exist.
  assert.match(fn, /if \(!r\) return null;/);
  assert.match(fn, /Returns null when the row does not exist/, "and the reason is documented");
});

test("the id is validated before it reaches SQL", () => {
  const src = readFileSync(STORE, "utf8");
  const fn = src.slice(src.indexOf("export async function fetchLargoTurnResults"));
  assert.match(fn, /Number\.isInteger\(messageId\)/);
  assert.match(fn, /messageId <= 0/);
});

test("REPLAYED RESULTS WIN over anything the client sent", () => {
  const src = readFileSync(ROUTE, "utf8");
  // The whole point of the turn id is that the SERVER decides what evidence the card is built
  // from. If client-sent results could override, a caller could render a card from fabricated
  // evidence while the manifest still claimed the turn's provenance.
  assert.match(src, /replayed \? replayed\.toolResults : body\.capturedResults/);
});

test("the stored turn's OWN question drives routing", () => {
  const src = readFileSync(ROUTE, "utf8");
  // Otherwise a client could replay a trade turn's evidence under a level question's wording and
  // get a template the answer never supported.
  assert.match(src, /replayed\?\.question \?\? body\.question/);
});

test("a replayed card is MARKED as a replay in its manifest", () => {
  const src = readFileSync(ROUTE, "utf8");
  const marks = src.match(/replayOfTurn: replayed \? String\(replayed\.id\)/g) ?? [];
  // THREE sites: the plan preview plus both output paths (raster and markup). An asset found
  // later can never hide that it was regenerated from stored evidence rather than rendered live,
  // and the preview tells a member before they render.
  assert.equal(marks.length, 3, `expected plan + both render paths to mark the replay, got ${marks.length}`);
});

test("turn replay is a USER capability, never a cron one", () => {
  const src = readFileSync(ROUTE, "utf8");
  // A cron-authorised caller has no user to scope ownership against, so there is no safe way to
  // resolve "whose turn is this". Marketing reuse passes its own bundle instead.
  assert.match(src, /userId \? await fetchLargoTurnResults/);
});

test("an unresolvable turn id FAILS, rather than silently rendering something else", () => {
  const src = readFileSync(ROUTE, "utf8");
  assert.match(src, /reason: "turn_not_found"/);
  assert.match(src, /status: 404/);
});

test("the turn id reaches the client on the envelope, and the UI passes it back", () => {
  const env = readFileSync("src/lib/bie/answer-envelope.ts", "utf8");
  assert.match(env, /turnId\?: number \| null;/, "envelope must carry it");

  const terminal = readFileSync("src/lib/largo-terminal.ts", "utf8");
  const wired = terminal.match(/envelope\.turnId = turnId/g) ?? [];
  assert.equal(wired.length, 2, "both persist call sites must attach it");

  const mount = readFileSync("src/features/largo/components/LargoAnswerMessage.tsx", "utf8");
  // THE ENVELOPE IS NOW THE FALLBACK, NOT THE CARRIER. This assertion used to demand
  // `turnId={envelope.turnId ?? null}` — pinning the exact coupling that turned out to be the bug:
  // `envelopeFromContract` returns null whenever the model's reply drifts off the section contract,
  // and the id died with it even though the turn had persisted fine. The id now rides top-level
  // (`turn_id`), and the envelope read is kept ONLY so a message rehydrated from before that
  // shipped still resolves its turn. See visual-mount.test.ts for the full five-hop journey.
  assert.match(
    mount,
    /turnId=\{turnId \?\? envelope\?\.turnId \?\? null\}/,
    "the mount must prefer the top-level id and fall back to the envelope's",
  );
});

test("only ASSISTANT rows are addressable as a turn", () => {
  const src = readFileSync(STORE, "utf8");
  // appendLargoMessage returns an id for assistant rows only — a user row carries no tool results
  // and nothing could be rendered from it.
  assert.match(src, /role === "assistant" \? \(Number\(inserted\.rows\[0\]\?\.id\) \|\| null\) : null/);
});

test("a replayed card gets its VERDICT from what Largo actually wrote", () => {
  // MEASURED ON A LIVE NVDA CARD: no headline at all — it opened on the spot price, so the single
  // most useful line on a graphic built to be posted was the one thing missing. Same root cause as
  // the auto-render break: the headline reaching the route is the ENVELOPE's, and
  // `envelopeFromContract` returns null whenever the reply drifts off the section contract. No
  // envelope, no headline, no verdict block (`available: (b) => !!b.headline`).
  //
  // The replayed turn has carried `answer` since turn replay shipped and nothing had used it.
  // Deriving from it is MORE coherent than the envelope, not less: the lead line becomes a
  // sentence Largo actually said about this turn rather than a re-parse that may have failed.
  const src = readFileSync(ROUTE, "utf8");
  // FROM THE VERDICT SECTION, NOT THE FIRST LINE. This originally asserted
  // `headlineFromMarkdown(replayed.answer` — and every contract-conforming answer opens with the
  // literal heading `**Verdict**`, so the largest text on every replayed card in production was
  // the word "Verdict". The manifest recorded a headline either way; only the pixels showed WHICH.
  assert.match(src, /answerSectionText\(replayed\.answer, "Verdict"\)/, "must read the verdict section");
  assert.match(src, /headlineFromMarkdown\(verdictSection/, "and take its first real line");
  assert.match(src, /headlineFromMarkdown\(replayed\.answer/, "keeping the non-conforming fallback");
  // Client-supplied headline still wins, so an envelope-rich turn is completely unchanged.
  assert.match(src, /headline: body\.headline \?\? \(replayedHeadline \|\| null\)/);
  // And ONLY for replays: a bundle posted without a turn id has no answer text, and inventing a
  // verdict from tool results is exactly what this library refuses to do.
  // ONLY for replays. A bundle posted without a turn id has no answer text, and inventing a
  // verdict from tool results is exactly what this library refuses to do. The guard moved onto
  // the verdict lookup when the headline stopped being the answer's first line.
  assert.match(src, /replayed\?\.answer \? answerSectionText/);
});
