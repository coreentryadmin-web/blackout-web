import { test } from "node:test";
import assert from "node:assert/strict";
import { LARGO_TOOL_DEFS } from "@/lib/largo/tool-defs";
import {
  LARGO_CAPABILITIES,
  capabilitiesFor,
  capabilitiesSharingEntity,
  changeCapabilities,
  historicalCapabilities,
  rankCapabilities,
  registryToolNames,
  uncataloguedTools,
} from "./capability-registry";

test("every catalogued tool actually exists — the catalog cannot advertise a dead capability", () => {
  // The whole value of a catalog is that it is TRUE. A renamed or deleted tool must fail here,
  // not at runtime when a member is waiting, and not silently as an unreachable capability.
  const real = new Set(LARGO_TOOL_DEFS.map((t) => t.name));
  const missing = LARGO_CAPABILITIES.filter((c) => !real.has(c.tool)).map((c) => `${c.id} -> ${c.tool}`);
  assert.deepEqual(missing, [], "capabilities naming a non-existent tool");
});

test("capability ids are unique and stable-looking", () => {
  const ids = LARGO_CAPABILITIES.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate capability id");
  for (const id of ids) {
    // product.name — ids appear in query plans and diagnostics, so a scheme change is a breaking
    // change and should be a deliberate one.
    assert.match(id, /^[a-z_]+\.[a-z_]+$/, `${id} must be product.name`);
  }
});

test("joinsWith only references capabilities that exist", () => {
  // A dangling join is worse than no join: it tells the planner a cross-product path exists and
  // the path dead-ends.
  const ids = new Set(LARGO_CAPABILITIES.map((c) => c.id));
  const dangling: string[] = [];
  for (const c of LARGO_CAPABILITIES) {
    for (const j of c.joinsWith ?? []) if (!ids.has(j)) dangling.push(`${c.id} -> ${j}`);
  }
  assert.deepEqual(dangling, [], "dangling joinsWith references");
});

test("joined capabilities actually share an entity key", () => {
  // The point of a join is a shared key. Declaring a join between two capabilities with no key in
  // common would invite the model to correlate rows that cannot be correlated — the fastest route
  // to a confident, fabricated cross-product claim.
  const byId = new Map(LARGO_CAPABILITIES.map((c) => [c.id, c]));
  const bad: string[] = [];
  for (const c of LARGO_CAPABILITIES) {
    for (const j of c.joinsWith ?? []) {
      const other = byId.get(j);
      if (!other) continue;
      if (!c.entities.some((e) => other.entities.includes(e))) bad.push(`${c.id} <-> ${j}`);
    }
  }
  assert.deepEqual(bad, [], "joins declared between capabilities with no shared entity key");
});

test("historicalCapabilities NEVER includes a live-only source", () => {
  // The guard against the worst temporal failure: answering "what did SPX look like at 10:15"
  // from a live-only source gives a confident, well-sourced answer about the wrong moment, and
  // nothing downstream can detect it.
  for (const c of historicalCapabilities()) {
    assert.notEqual(c.temporal, "live_only", `${c.id} is live_only and must not be offered for history`);
    assert.notEqual(c.temporal, "as_of", `${c.id} is as_of and cannot answer about a past moment`);
  }
  assert.ok(historicalCapabilities().length > 0, "there must be SOME way to answer a historical question");
});

test("changeCapabilities are all sources that can express a delta", () => {
  for (const c of changeCapabilities()) {
    assert.ok(
      c.temporal === "event_log" || c.temporal === "windowed",
      `${c.id} cannot express a change`
    );
  }
  // "What changed?" is the flagship capability — if this ever empties, that feature is dead.
  assert.ok(changeCapabilities().length >= 5, "too few change-capable sources to answer 'what changed'");
});

test("the live-only sources are explicitly caveated", () => {
  // A live_only source that does not SAY it is live-only will eventually be used for a historical
  // question. The caveat is what the model quotes when it declines.
  for (const c of LARGO_CAPABILITIES.filter((x) => x.temporal === "live_only")) {
    assert.ok(c.caveat, `${c.id} is live_only and must carry a caveat saying so`);
    assert.match(c.caveat!, /live only/i);
  }
});

test("entitlement filtering is deterministic and never leaks admin data to premium", () => {
  const premium = capabilitiesFor("premium");
  assert.ok(premium.length > 0);
  for (const c of premium) {
    assert.notEqual(c.entitlement, "admin", `${c.id} is admin-only and must not appear for premium`);
  }
  // Admin sees at least everything premium sees — a superset, never a different set.
  const adminIds = new Set(capabilitiesFor("admin").map((c) => c.id));
  for (const c of premium) assert.ok(adminIds.has(c.id), `${c.id} missing from the admin set`);
});

test("rankCapabilities ORDERS and never HIDES — discovery cannot make an answer impossible", () => {
  // This is the lesson of the deleted intent allowlist (FINDINGS 2026-08-10) encoded as a test.
  // A phrasing nobody anticipated must still be able to reach every capability; ranking may only
  // change the ORDER.
  const all = LARGO_CAPABILITIES.length;
  const ranked = rankCapabilities("something nobody has ever asked before zzz", all);
  assert.equal(ranked.length, all, "ranking with a full limit must return every capability");
  const gibberish = rankCapabilities("qqqzzz", all).map((c) => c.id).sort();
  const real = rankCapabilities("gamma wall", all).map((c) => c.id).sort();
  assert.deepEqual(gibberish, real, "the same SET must be reachable regardless of wording");
});

test("rankCapabilities surfaces the obviously-right capability first for clear questions", () => {
  const top = (q: string) => rankCapabilities(q, 5).map((c) => c.id);
  assert.ok(top("where are the dealer gamma walls").includes("thermal.positioning"));
  assert.ok(top("what changed on the matrix since earlier").includes("thermal.matrix_changes"));
  assert.ok(top("what is night hawk watching but didn't trigger").includes("nighthawk.rejections"));
  assert.ok(top("how many trades did we win last month").some((id) => id.startsWith("record.")));
  assert.ok(top("what's the biggest risk in my open positions").includes("spx.open_plays"));
});

test("every product has at least one capability", () => {
  // A product with no capability is invisible to Largo however good its data is.
  const products = new Set(LARGO_CAPABILITIES.map((c) => c.product));
  for (const p of ["SPX_SLAYER", "HELIX", "THERMAL", "VECTOR", "NIGHT_HAWK", "TRACK_RECORD", "MARKET", "PLATFORM"]) {
    assert.ok(products.has(p as never), `${p} has no registered capability`);
  }
});

test("the catalog reports its own coverage gap instead of hiding it", () => {
  const gap = uncataloguedTools();
  // Not asserted to be empty — 116 tools include many single-purpose provider reads that do not
  // warrant a catalog entry. What matters is that the gap is COMPUTABLE, so it can be worked off
  // deliberately rather than discovered by a member asking something Largo cannot plan for.
  assert.ok(Array.isArray(gap));
  assert.ok(registryToolNames().size > 0);
  assert.ok(gap.length < LARGO_TOOL_DEFS.length, "the catalog must cover something");
});

test("entity lookup returns the join surface for cross-product reasoning", () => {
  const byTicker = capabilitiesSharingEntity("ticker").map((c) => c.product);
  // "Where do Helix and Thermal disagree" is only answerable because both key on ticker.
  assert.ok(byTicker.includes("HELIX"));
  assert.ok(byTicker.includes("THERMAL"));
  assert.ok(capabilitiesSharingEntity("play").length >= 2, "play-keyed joins power trade post-mortems");
});

test("known live-only sources stay classified live_only", () => {
  // A mutation test exposed the gap this closes: flipping market.quote's temporal class to
  // point_in_time passed every other check, because a registry cannot detect a lie about its own
  // data by inspecting itself. So the classification of the sources where it MATTERS is pinned
  // here as an external fact. get_quote returns the current price and has no history parameter;
  // if that ever changes, this test should be updated deliberately, not silently.
  const quote = LARGO_CAPABILITIES.find((c) => c.id === "market.quote");
  assert.equal(quote?.temporal, "live_only", "get_quote cannot answer about the past");
  const history = LARGO_CAPABILITIES.find((c) => c.id === "market.option_price_history");
  assert.equal(history?.temporal, "point_in_time", "option price history is the past-capable source");
});

test("a join to an entity-less capability is rejected", () => {
  // platform.internal_api declares no entities, so nothing can be correlated with it. A declared
  // join would tell the planner a correlation path exists where none does.
  const escape = LARGO_CAPABILITIES.find((c) => c.id === "platform.internal_api");
  assert.deepEqual(escape?.entities, [], "the escape hatch must declare no join keys");
  for (const c of LARGO_CAPABILITIES) {
    assert.ok(
      !(c.joinsWith ?? []).includes("platform.internal_api"),
      `${c.id} must not declare a join to the entity-less escape hatch`
    );
  }
});
