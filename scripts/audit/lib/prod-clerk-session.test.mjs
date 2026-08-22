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

// ── sweepLeakedAuditUsers selection ────────────────────────────────────────────────────────────
// These guard the defect that made the sweep DEAD CODE for its whole life: it paged the 100
// OLDEST users of a 799-user instance (all real members, 23-65 days old), matched zero temp
// users, and deleted nothing — while 81 leaked temp users piled up holding phone numbers from
// the +1415555xxxx pool. The request is now scoped with `email_address_query`; these pin the
// selection rules that make running it unattended safe.

import {
  selectSweepableAuditUsers,
  AUDIT_TEMP_EMAIL_PREFIX,
  STALE_USER_MS,
} from "./prod-clerk-session.mjs";

const NOW = 1_700_000_000_000;
const user = (id, addr, ageMs) => ({
  id,
  created_at: NOW - ageMs,
  email_addresses: [{ email_address: addr }],
});
const tagged = (id, ageMs) => user(id, `${AUDIT_TEMP_EMAIL_PREFIX}abc123@blackouttrades.com`, ageMs);

test("selects tagged temp users older than the age gate", () => {
  const picked = selectSweepableAuditUsers([tagged("u1", 31 * 60_000), tagged("u2", 19 * 3_600_000)], NOW);
  assert.deepEqual(picked.map((u) => u.id), ["u1", "u2"]);
});

test("NEVER sweeps a user younger than the age gate — it may belong to a LIVE run", () => {
  // The age gate is the whole safety argument: it must exceed the longest harness (~15 min), or
  // this reintroduces the concurrent-run delete race per-run identity was built to remove.
  const young = [tagged("fresh", 0), tagged("mid", 15 * 60_000), tagged("edge", STALE_USER_MS - 1)];
  assert.deepEqual(selectSweepableAuditUsers(young, NOW), []);
});

test("leaves the bare pre-per-run shared address alone", () => {
  // `claude-audit-temp@` (no `+tag`) may still be in use by another agent or an older checkout.
  // The server-side filter is a substring match and DOES return it, so this guard still does work.
  const bare = user("shared", "claude-audit-temp@blackouttrades.com", 10 * 3_600_000);
  assert.deepEqual(selectSweepableAuditUsers([bare], NOW), []);
});

test("never sweeps a real member, however old", () => {
  const members = [
    user("m1", "someone@gmail.com", 65 * 86_400_000),
    user("m2", "trader@blackouttrades.com", 30 * 86_400_000),
    // an address that merely CONTAINS the tag must not match — the prefix is anchored
    user("m3", "not-claude-audit-temp+x@blackouttrades.com", 40 * 86_400_000),
  ];
  assert.deepEqual(selectSweepableAuditUsers(members, NOW), []);
});

test("a non-array body (error payload, null) yields no deletions", () => {
  // The old code returned 0 on a non-array; deleting off an unparsed error body would be far worse
  // than skipping housekeeping.
  for (const bad of [null, undefined, { message: "rate limited" }, "nope", 42]) {
    assert.deepEqual(selectSweepableAuditUsers(bad, NOW), [], String(bad));
  }
});

test("rows missing an id, a created_at, or an email are skipped, not guessed", () => {
  const junk = [
    { id: "", email_addresses: [{ email_address: `${AUDIT_TEMP_EMAIL_PREFIX}a@x.com` }], created_at: NOW - 10 * 3_600_000 },
    { id: "no-created", email_addresses: [{ email_address: `${AUDIT_TEMP_EMAIL_PREFIX}b@x.com` }] },
    { id: "str-created", email_addresses: [{ email_address: `${AUDIT_TEMP_EMAIL_PREFIX}c@x.com` }], created_at: "old" },
    { id: "no-email", created_at: NOW - 10 * 3_600_000 },
    null,
  ];
  assert.deepEqual(selectSweepableAuditUsers(junk, NOW), []);
});
