import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isClerkPhoneCollision,
  isClerkEmailCollision,
  classifyClerkCreateFailure,
  createOrAdoptAuditUser,
  createOrAdoptAuditUserViaCurl,
} from "./clerk-audit-user.mjs";

// The EXACT payload data-validator.mjs died on, live, 2026-08-06 17:33 UTC. Clerk sent a
// bare human-readable `message` with no `meta.param_name`, which is why the discriminator
// needs the message fallback and not just the structured param.
const LIVE_PHONE_COLLISION = [
  { message: "This phone number is already associated with an existing account." },
];

test("isClerkPhoneCollision detects phone-already-associated errors", () => {
  assert.equal(isClerkPhoneCollision(LIVE_PHONE_COLLISION), true);
  assert.equal(
    isClerkPhoneCollision([{ code: "form_identifier_exists", meta: { param_name: "phone_number" } }]),
    true
  );
  // camelCase meta (SDK/edge-serialized shape)
  assert.equal(
    isClerkPhoneCollision([{ code: "form_identifier_exists", meta: { paramName: "phone_number" } }]),
    true
  );
  // A bare form_identifier_exists with no param is the EMAIL case, not the phone one.
  assert.equal(isClerkPhoneCollision([{ code: "form_identifier_exists" }]), false);
  assert.equal(isClerkPhoneCollision([{ code: "form_param_format_invalid" }]), false);
  assert.equal(isClerkPhoneCollision(null), false);
});

test("isClerkEmailCollision detects form_identifier_exists but never a phone clash", () => {
  assert.equal(isClerkEmailCollision([{ code: "form_identifier_exists" }]), true);
  assert.equal(
    isClerkEmailCollision([{ code: "form_identifier_exists", meta: { param_name: "email_address" } }]),
    true
  );
  // The regression that caused the outage: a PHONE collision must NOT read as an e-mail one
  // (both carry form_identifier_exists), or the recovery path goes looking by e-mail and
  // finds nothing.
  assert.equal(
    isClerkEmailCollision([{ code: "form_identifier_exists", meta: { param_name: "phone_number" } }]),
    false
  );
  assert.equal(isClerkEmailCollision(LIVE_PHONE_COLLISION), false);
});

test("classifyClerkCreateFailure separates the three outcomes", () => {
  assert.equal(classifyClerkCreateFailure(LIVE_PHONE_COLLISION), "phone_collision");
  assert.equal(classifyClerkCreateFailure([{ code: "form_identifier_exists" }]), "email_collision");
  assert.equal(classifyClerkCreateFailure([{ code: "authentication_invalid" }]), "other");
});

test("createOrAdoptAuditUser retries with a FRESH phone until the collision clears", async () => {
  const tried = [];
  let calls = 0;
  const res = await createOrAdoptAuditUser({
    phone: "+14155550001",
    newPhone: () => `+141555500${10 + calls}`,
    createUser: (p) => {
      tried.push(p);
      // Fail the first three attempts with the live phone-collision payload, then succeed.
      return ++calls > 3 ? { id: "user_ok" } : { errors: LIVE_PHONE_COLLISION };
    },
    adoptByEmail: () => {
      throw new Error("adopt-by-email must not run for a phone collision");
    },
  });

  assert.deepEqual(res, { userId: "user_ok", phone: tried.at(-1), adopted: false, attempts: 4 });
  assert.equal(tried.length, 4);
  assert.equal(tried[0], "+14155550001", "first attempt honors the caller-supplied phone");
  assert.equal(new Set(tried).size, 4, "every retry draws a distinct number");
});

test("createOrAdoptAuditUser never re-sends a pinned AUDIT_PHONE on retry", async () => {
  // An operator-pinned phone that is ALREADY taken must not burn every attempt on itself.
  const tried = [];
  const res = await createOrAdoptAuditUser({
    phone: "+14155559999",
    newPhone: () => "+14155551234",
    createUser: (p) => {
      tried.push(p);
      return p === "+14155559999" ? { errors: LIVE_PHONE_COLLISION } : { id: "user_fresh" };
    },
  });
  assert.equal(res.userId, "user_fresh");
  assert.deepEqual(tried, ["+14155559999", "+14155551234"]);
});

test("createOrAdoptAuditUser gives up after maxPhoneAttempts with a phone-collision message", async () => {
  let calls = 0;
  const res = await createOrAdoptAuditUser({
    newPhone: () => `+141555512${calls}`,
    maxPhoneAttempts: 3,
    createUser: () => {
      calls++;
      return { errors: LIVE_PHONE_COLLISION };
    },
  });
  assert.equal(calls, 3);
  assert.equal(res.userId, undefined);
  assert.equal(res.errorKind, "phone_collision");
  assert.equal(res.attempts, 3);
  assert.match(res.error, /persisted across 3 attempt/);
});

test("createOrAdoptAuditUser still adopts the existing user on an EMAIL collision", async () => {
  let creates = 0;
  const patched = [];
  const res = await createOrAdoptAuditUser({
    createUser: () => {
      creates++;
      return { errors: [{ code: "form_identifier_exists", meta: { param_name: "email_address" } }] };
    },
    adoptByEmail: () => ({ id: "user_leftover" }),
    onAdopt: (id) => patched.push(id),
  });
  assert.deepEqual(res, { userId: "user_leftover", phone: null, adopted: true, attempts: 1 });
  assert.equal(creates, 1, "an e-mail collision must not spin the phone-retry loop");
  assert.deepEqual(patched, ["user_leftover"], "adopted user gets its metadata re-stamped");
});

test("createOrAdoptAuditUser adopts when the e-mail AND the phone both collide", async () => {
  const res = await createOrAdoptAuditUser({
    createUser: () => ({
      errors: [
        { code: "form_identifier_exists", meta: { param_name: "email_address" } },
        { code: "form_identifier_exists", meta: { param_name: "phone_number" } },
      ],
    }),
    adoptByEmail: () => ({ id: "user_both" }),
  });
  assert.equal(res.userId, "user_both");
  assert.equal(res.adopted, true);
});

test("createOrAdoptAuditUser fails fast on a non-collision error (no pointless retries)", async () => {
  let calls = 0;
  const res = await createOrAdoptAuditUser({
    createUser: () => {
      calls++;
      return { errors: [{ code: "authentication_invalid", message: "Invalid API key" }] };
    },
  });
  assert.equal(calls, 1, "a bad secret will not fix itself by redrawing a phone number");
  assert.equal(res.errorKind, "other");
  assert.match(res.error, /authentication_invalid/);
});

test("createOrAdoptAuditUser awaits async transports too (fetch-based harnesses)", async () => {
  let calls = 0;
  const res = await createOrAdoptAuditUser({
    newPhone: () => `+14155557${calls}00`,
    createUser: async () => (++calls > 1 ? { id: "user_async" } : { errors: LIVE_PHONE_COLLISION }),
    adoptByEmail: async () => null,
  });
  assert.equal(res.userId, "user_async");
  assert.equal(res.attempts, 2);
});

test("createOrAdoptAuditUserViaCurl drives the real spawnSync-curl contract", async () => {
  // Fake of the harnesses' curl(): { method, url, headers, json } -> { s, b }.
  const seen = [];
  let posts = 0;
  const curl = ({ method = "GET", url, json }) => {
    seen.push(`${method} ${url}`);
    if (method === "POST" && url.endsWith("/users")) {
      posts++;
      if (posts === 1) return { s: 422, b: JSON.stringify({ errors: LIVE_PHONE_COLLISION }) };
      return { s: 200, b: JSON.stringify({ id: "user_curl", phone: json.phone_number[0] }) };
    }
    return { s: 200, b: "{}" };
  };

  const res = await createOrAdoptAuditUserViaCurl({
    curl,
    secret: "sk_test_dummy",
    email: "claude-audit-temp@blackouttrades.com",
    phone: "+14155550123",
  });

  assert.equal(res.userId, "user_curl");
  assert.equal(res.attempts, 2);
  assert.equal(posts, 2);
  // The e-mail lookup is reserved for e-mail collisions — a phone clash must not trigger it.
  assert.ok(!seen.some((s) => s.includes("email_address=")), "no e-mail lookup on a phone collision");
});

test("createOrAdoptAuditUserViaCurl adopts by e-mail and re-PATCHes metadata", async () => {
  const seen = [];
  const curl = ({ method = "GET", url }) => {
    seen.push(`${method} ${url.replace(/\?.*/, "")}`);
    if (method === "POST" && url.endsWith("/users")) {
      return { s: 422, b: JSON.stringify({ errors: [{ code: "form_identifier_exists" }] }) };
    }
    if (method === "GET" && url.includes("email_address=")) {
      return { s: 200, b: JSON.stringify([{ id: "user_leftover" }]) };
    }
    return { s: 200, b: "{}" };
  };

  const res = await createOrAdoptAuditUserViaCurl({
    curl,
    secret: "sk_test_dummy",
    email: "claude-audit-temp@blackouttrades.com",
  });

  assert.equal(res.userId, "user_leftover");
  assert.equal(res.adopted, true);
  assert.ok(seen.includes("PATCH https://api.clerk.com/v1/users/user_leftover"));
});

test("createOrAdoptAuditUserViaCurl also reads the { status, body } curl shape", async () => {
  // comprehensive-endpoint-audit / exhaustive-platform-audit return { status, timeMs, body }
  // instead of { s, b } — the adapter must handle both without a per-harness shim.
  let posts = 0;
  const curl = ({ method = "GET", url }) => {
    if (method === "POST" && url.endsWith("/users")) {
      return ++posts === 1
        ? { status: 422, timeMs: 3, body: JSON.stringify({ errors: LIVE_PHONE_COLLISION }) }
        : { status: 200, timeMs: 3, body: JSON.stringify({ id: "user_body_shape" }) };
    }
    return { status: 200, timeMs: 1, body: "{}" };
  };
  const res = await createOrAdoptAuditUserViaCurl({ curl, secret: "sk_test_dummy", email: "x@y.com" });
  assert.equal(res.userId, "user_body_shape");
  assert.equal(res.attempts, 2);
});

test("createOrAdoptAuditUserViaCurl surfaces a readable error when creation never succeeds", async () => {
  const curl = () => ({ s: 401, b: JSON.stringify({ errors: [{ code: "authentication_invalid" }] }) });
  const res = await createOrAdoptAuditUserViaCurl({ curl, secret: "sk_test_dummy", email: "x@y.com" });
  assert.equal(res.userId, undefined);
  assert.match(res.error, /authentication_invalid/);
});
