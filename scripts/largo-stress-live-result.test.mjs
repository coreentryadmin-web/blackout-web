import assert from "node:assert/strict";
import test from "node:test";
import { liveResultFromFetchError } from "./largo-stress-transport.mjs";

test("liveResultFromFetchError maps ECONNRESET to transport SKIP shape", () => {
  const err = new TypeError("fetch failed", { cause: { code: "ECONNRESET" } });
  const res = liveResultFromFetchError(err, 42);
  assert.equal(res.status, 0);
  assert.equal(res.answer, "");
  assert.equal(res.transport_error, "ECONNRESET");
  assert.equal(res.ms, 42);
});

test("liveResultFromFetchError never leaves transport_error empty", () => {
  const res = liveResultFromFetchError(new Error(""), 1);
  assert.ok(res.transport_error.length > 0);
});
