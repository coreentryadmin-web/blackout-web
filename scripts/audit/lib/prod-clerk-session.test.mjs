import test from "node:test";
import assert from "node:assert/strict";
import { mergeCookies } from "./prod-clerk-session.mjs";

// These guard the exact defect that made every long-running audit die at ~72s: the client cookie
// jar was a snapshot, so Clerk's rotated `__client` was never picked up and refresh() went null.

test("mergeCookies REPLACES a rotated cookie rather than appending a duplicate", () => {
  const jar = ["__client=OLD", "__client_uat=123"];
  mergeCookies(jar, ["__client=NEW"]);
  assert.deepEqual(jar, ["__client=NEW", "__client_uat=123"]);
});

test("mergeCookies appends genuinely new cookies", () => {
  const jar = ["__client=A"];
  mergeCookies(jar, ["__session=S", "extra=E"]);
  assert.deepEqual(jar, ["__client=A", "__session=S", "extra=E"]);
});

test("mergeCookies mutates in place so a closure over the jar sees the rotation", () => {
  // refresh() closes over the jar; returning a copy would leave the closure on stale cookies —
  // which is precisely the bug, just relocated.
  const jar = ["__client=OLD"];
  const readLater = () => jar.join("; ");
  mergeCookies(jar, ["__client=ROTATED"]);
  assert.equal(readLater(), "__client=ROTATED");
});

test("mergeCookies is a no-op on an empty response", () => {
  const jar = ["__client=A", "__client_uat=1"];
  mergeCookies(jar, []);
  assert.deepEqual(jar, ["__client=A", "__client_uat=1"]);
});

test("mergeCookies handles values containing '=' without corrupting the name", () => {
  const jar = ["__client=abc=def"];
  mergeCookies(jar, ["__client=xyz=123"]);
  assert.deepEqual(jar, ["__client=xyz=123"], "name is the part before the FIRST '='");
});
