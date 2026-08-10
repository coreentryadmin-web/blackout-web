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
  assert.match(mount, /turnId=\{envelope\.turnId \?\? null\}/, "the mount must pass it through");
});

test("only ASSISTANT rows are addressable as a turn", () => {
  const src = readFileSync(STORE, "utf8");
  // appendLargoMessage returns an id for assistant rows only — a user row carries no tool results
  // and nothing could be rendered from it.
  assert.match(src, /role === "assistant" \? \(Number\(inserted\.rows\[0\]\?\.id\) \|\| null\) : null/);
});
