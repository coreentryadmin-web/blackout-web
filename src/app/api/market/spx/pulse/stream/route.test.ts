import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// /spx/pulse/stream is the live SSE lane for the same index/tide numbers as /spx/pulse.
// It must round at the boundary so members never see IEEE float tails on the wire.
const src = readFileSync("src/app/api/market/spx/pulse/stream/route.ts", "utf8");
const sibling = readFileSync("src/app/api/market/spx/pulse/route.ts", "utf8");

test("/spx/pulse/stream rounds floats before JSON.stringify, like /spx/pulse", () => {
  assert.match(sibling, /roundFloats\(pulse\)/, "precondition: REST pulse route rounds");
  assert.match(src, /import \{ roundFloats \} from "@\/lib\/round-floats"/);
  assert.match(src, /JSON\.stringify\(\s*roundFloats\(/);
});

test("spx pulse stream: local index freshness uses isWsUpdatedAtFresh (source scan)", () => {
  assert.match(src, /import \{ isWsUpdatedAtFresh \} from "@\/lib\/ws\/timestamp-freshness"/);
  assert.match(
    src,
    /isWsUpdatedAtFresh\(fresh, 10_000\)/,
    "local indexStore freshness must reject clock-skewed future updatedAt stamps"
  );
  assert.doesNotMatch(
    src,
    /Date\.now\(\)\s*-\s*fresh\s*<\s*10_000/,
    "raw Date.now()-fresh must not gate SPX pulse local freshness"
  );
});

test("/spx/pulse/stream sanitizes index change_pct on REST anchor only", () => {
  assert.match(src, /clusterIndexSpotChangePct/, "SSE wire must gate change_pct like /spx/pulse");
  assert.match(src, /sanitizeIndexWire\(snapshot\["I:SPX"\]\)/);
  assert.match(src, /sanitizeIndexWire\(snapshot\["I:VIX"\]\)/);
});

/**
 * BUG FIX (round 409, DISCOVERY-lane): `NO_STORE_STREAM_HEADERS` was imported since PR #1224
 * ("close remaining CDN gaps") but never actually spread into the SSE response's `headers`
 * object — the response kept a hand-rolled `{"Content-Type": ..., "Cache-Control": "no-cache",
 * Connection: "keep-alive"}` literal with no `CDN-Cache-Control`/`Cloudflare-CDN-Cache-Control:
 * no-store`, unlike every sibling SSE stream route (flows/stream, vector/stream,
 * gex-matrix-deltas, admin/apis/stream, stocks/spot-stream all spread
 * `...NO_STORE_STREAM_HEADERS`). A Cloudflare cache rule with `override_origin` set could
 * therefore edge-cache this auth-gated, per-session SSE response the same way #1221/#1224 fixed
 * for the JSON routes they touched.
 *
 * `src/lib/no-store-headers.guard.test.ts` could not catch this: it only asserts a route file
 * IMPORTS the shared constant somewhere, never that the import is actually used in a returned
 * response — so a route that imports the constant and silently never applies it (exactly what
 * happened here) still passes that guard. This test closes that specific gap for this route.
 */
test("/spx/pulse/stream actually SPREADS NO_STORE_STREAM_HEADERS into its SSE response " +
  "(importing it is not enough — this is the bug this test regresses against)", () => {
  assert.match(
    src,
    /from\s+["']@\/lib\/no-store-headers["']/,
    "route.ts must import the shared no-store header constants"
  );

  // Isolate the NextResponse(stream, { headers: {...} }) block that carries the real SSE
  // response — the ONE place the CDN no-store headers must land. Matched narrowly (stream, not
  // the 503 "too many active streams" text response, which every sibling route also leaves
  // header-bare since it is never a cacheable surface).
  const streamResponseBlock = src.slice(src.indexOf("return new NextResponse(stream"));
  assert.ok(
    streamResponseBlock.length > 0,
    "expected a `return new NextResponse(stream, ...)` response in route.ts"
  );
  assert.match(
    streamResponseBlock,
    /\.\.\.NO_STORE_STREAM_HEADERS/,
    "the SSE stream response must spread ...NO_STORE_STREAM_HEADERS into its headers object — " +
      "importing the constant alone does not apply it to the actual Response (see flows/stream, " +
      "vector/stream, gex-matrix-deltas, admin/apis/stream, stocks/spot-stream for the " +
      "established pattern)"
  );

  // The CDN-specific headers are the load-bearing part of NO_STORE_STREAM_HEADERS (see
  // no-store-headers.ts's own header comment) — assert the spread isn't shadowed by a later
  // literal `Cache-Control` that would win on object-spread order and silently undo it.
  const headersObjectMatch = streamResponseBlock.match(/headers:\s*{([\s\S]*?)}\s*,?\s*\)\s*;/);
  assert.ok(headersObjectMatch, "could not locate the headers object literal to inspect its order");
  const headersBody = headersObjectMatch![1]!;
  const spreadIdx = headersBody.indexOf("...NO_STORE_STREAM_HEADERS");
  const literalCacheControlIdx = headersBody.indexOf('"Cache-Control"');
  assert.ok(spreadIdx !== -1, "expected the spread inside the headers object literal");
  if (literalCacheControlIdx !== -1) {
    assert.ok(
      spreadIdx < literalCacheControlIdx,
      "a literal Cache-Control after the NO_STORE_STREAM_HEADERS spread would silently override " +
        "its no-cache value on object-spread merge — the spread must come first"
    );
  }
});
