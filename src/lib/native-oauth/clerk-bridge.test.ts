import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveNativeOAuthUser,
  externalIdFor,
  type ClerkUsersApi,
  type NativeIdentity,
} from "./clerk-bridge";

/** In-memory Clerk stand-in: users keyed by id, with email + optional external_id, and a call log. */
function fakeApi(seed: Array<{ id: string; email: string; externalId?: string }> = []) {
  const users = seed.map((u) => ({ ...u }));
  const calls: string[] = [];
  let n = 0;
  const api: ClerkUsersApi = {
    async findByExternalId(externalId) {
      calls.push(`findByExternalId:${externalId}`);
      const u = users.find((x) => x.externalId === externalId);
      return u ? { id: u.id } : null;
    },
    async findByEmail(email) {
      calls.push(`findByEmail:${email}`);
      const u = users.find((x) => x.email === email);
      return u ? { id: u.id } : null;
    },
    async create({ email, externalId }) {
      calls.push(`create:${email}:${externalId}`);
      const u = { id: `user_new_${++n}`, email, externalId };
      users.push(u);
      return { id: u.id };
    },
    async bindExternalId(userId, externalId) {
      calls.push(`bind:${userId}:${externalId}`);
      const u = users.find((x) => x.id === userId);
      if (u) u.externalId = externalId;
    },
  };
  return { api, users, calls };
}

const base: NativeIdentity = {
  provider: "apple",
  sub: "attacker_sub_123",
  name: null,
  tokenEmail: "",
  tokenEmailVerified: false,
  fallbackEmail: "",
};

test("ATO: an unverified fallbackEmail can NEVER select an existing account", async () => {
  // The exact exploit: attacker holds a valid Apple token for THEIR OWN sub with no email claim,
  // and passes the victim's email as fallbackEmail. The victim's account exists (by email only,
  // not bound to the attacker's sub). The resolver must refuse — not mint the victim's id.
  const { api, calls } = fakeApi([{ id: "user_victim", email: "victim@example.com" }]);
  await assert.rejects(
    () => resolveNativeOAuthUser(api, { ...base, fallbackEmail: "victim@example.com" }),
    /refusing to bind an unverified email to an existing account/,
  );
  assert.ok(!calls.some((c) => c.startsWith("bind:")), "must not bind the victim account");
  assert.ok(!calls.some((c) => c.startsWith("create:")), "must not create/adopt anything");
});

test("returning user: a bound sub signs in by identity, no email needed", async () => {
  // The subsequent-Apple-login path the old code CLAIMED but never had. Token carries no email.
  const ext = externalIdFor("apple", "real_user_sub");
  const { api } = fakeApi([{ id: "user_real", email: "real@example.com", externalId: ext }]);
  const r = await resolveNativeOAuthUser(api, { ...base, sub: "real_user_sub", fallbackEmail: "anything@evil.com" });
  assert.deepEqual(r, { id: "user_real", created: false });
});

test("first-touch, verified token email, no existing account → creates and binds external_id", async () => {
  const { api, users } = fakeApi([]);
  const r = await resolveNativeOAuthUser(api, {
    ...base,
    sub: "new_sub",
    tokenEmail: "new@example.com",
    tokenEmailVerified: true,
  });
  assert.equal(r.created, true);
  const created = users.find((u) => u.id === r.id)!;
  assert.equal(created.email, "new@example.com");
  assert.equal(created.externalId, externalIdFor("apple", "new_sub"), "must stamp the identity binding");
});

test("first-touch, VERIFIED email matching an existing account → adopt + bind (linking)", async () => {
  // A web signup ('same@example.com', no external_id) links iOS Apple for the first time. Because
  // the email is verified, adopting it is safe — and we bind the sub so future logins match by it.
  const { api, calls } = fakeApi([{ id: "user_web", email: "same@example.com" }]);
  const r = await resolveNativeOAuthUser(api, {
    ...base,
    sub: "apple_sub_x",
    tokenEmail: "same@example.com",
    tokenEmailVerified: true,
  });
  assert.deepEqual(r, { id: "user_web", created: false });
  assert.ok(calls.includes(`bind:user_web:${externalIdFor("apple", "apple_sub_x")}`), "must bind the sub");
});

test("a token email that is present but UNVERIFIED is not trusted to select an account", async () => {
  // emailVerified=false must behave like the fallback path, not the verified path.
  const { api } = fakeApi([{ id: "user_v", email: "victim@example.com" }]);
  await assert.rejects(
    () =>
      resolveNativeOAuthUser(api, {
        ...base,
        tokenEmail: "victim@example.com",
        tokenEmailVerified: false,
        fallbackEmail: "victim@example.com",
      }),
    /refusing to bind an unverified email to an existing account/,
  );
});

test("first-touch, fallbackEmail with NO existing account → creates a new bound account", async () => {
  const { api, users } = fakeApi([]);
  const r = await resolveNativeOAuthUser(api, { ...base, sub: "s1", fallbackEmail: "brand@new.com" });
  assert.equal(r.created, true);
  assert.equal(users.find((u) => u.id === r.id)!.externalId, externalIdFor("apple", "s1"));
});

test("unbound identity with no email at all → refuses to sign in", async () => {
  const { api } = fakeApi([]);
  await assert.rejects(
    () => resolveNativeOAuthUser(api, { ...base, sub: "ghost" }),
    /unbound identity with no verified email/,
  );
});

test("external_id lookup happens BEFORE any email lookup (identity is primary)", async () => {
  const { api, calls } = fakeApi([{ id: "u", email: "e@e.com", externalId: externalIdFor("apple", "s") }]);
  await resolveNativeOAuthUser(api, { ...base, sub: "s", fallbackEmail: "e@e.com" });
  assert.equal(calls[0], `findByExternalId:${externalIdFor("apple", "s")}`, "identity check must be first");
  assert.ok(!calls.some((c) => c.startsWith("findByEmail:")), "must not fall through to email");
});
