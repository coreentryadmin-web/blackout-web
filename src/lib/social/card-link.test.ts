import test from "node:test";
import assert from "node:assert/strict";
import { CARD_LINK_TTL_MS, cardLinkUrl, signCardLink, verifyCardLink, type CardLinkParams } from "./card-link";

/**
 * This module is the ONLY thing standing between a sequential integer id and every member's desk
 * history rendered as a shareable graphic. `largo_messages.id` increments, so an unsigned
 * `/card/1234` would be walkable. These tests are the IDOR guard.
 */

const NOW = Date.parse("2026-08-11T12:00:00Z");
const BASE: CardLinkParams = {
  turnId: 2730,
  userId: "user_abc123",
  size: "x_portrait",
  format: "webp",
  exp: NOW + CARD_LINK_TTL_MS,
};

function withKey<T>(fn: () => T): T {
  const saved = process.env.CARD_LINK_SECRET;
  process.env.CARD_LINK_SECRET = "test-signing-key";
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env.CARD_LINK_SECRET;
    else process.env.CARD_LINK_SECRET = saved;
    }
}

test("a correctly signed, unexpired link verifies", () => {
  withKey(() => {
    const sig = signCardLink(BASE)!;
    assert.ok(sig);
    assert.equal(verifyCardLink(BASE, sig, NOW), true);
  });
});

test("EVERY signed field is tamper-evident", () => {
  withKey(() => {
    const sig = signCardLink(BASE)!;
    // turnId: the whole point — one link must not read a different member's turn.
    assert.equal(verifyCardLink({ ...BASE, turnId: 2731 }, sig, NOW), false);
    // userId: swapping the owner would hand the ownership-scoped query someone else's id.
    assert.equal(verifyCardLink({ ...BASE, userId: "user_zzz" }, sig, NOW), false);
    // size/format: the URL must name exactly ONE artefact, or a cached copy can differ from what
    // was approved for publication.
    assert.equal(verifyCardLink({ ...BASE, size: "story" }, sig, NOW), false);
    assert.equal(verifyCardLink({ ...BASE, format: "png" }, sig, NOW), false);
    // exp: extending your own link is the obvious attack.
    assert.equal(verifyCardLink({ ...BASE, exp: BASE.exp + 86_400_000 }, sig, NOW), false);
  });
});

test("an EXPIRED link fails even with a perfect signature", () => {
  withKey(() => {
    const sig = signCardLink(BASE)!;
    assert.equal(verifyCardLink(BASE, sig, BASE.exp + 1), false);
    assert.equal(verifyCardLink(BASE, sig, BASE.exp - 1), true, "still valid one ms before expiry");
  });
});

test("a garbage or empty signature fails without throwing", () => {
  withKey(() => {
    assert.equal(verifyCardLink(BASE, "", NOW), false);
    assert.equal(verifyCardLink(BASE, "not-hex", NOW), false);
    assert.equal(verifyCardLink(BASE, "a".repeat(64), NOW), false);
    // Length mismatch must be handled BEFORE timingSafeEqual, which throws on unequal buffers.
    assert.equal(verifyCardLink(BASE, "abc", NOW), false);
  });
});

test("NO key material means fail CLOSED — never an unsigned link", () => {
  const savedCard = process.env.CARD_LINK_SECRET;
  const savedClerk = process.env.CLERK_SECRET_KEY;
  delete process.env.CARD_LINK_SECRET;
  delete process.env.CLERK_SECRET_KEY;
  try {
    assert.equal(signCardLink(BASE), null);
    assert.equal(verifyCardLink(BASE, "anything", NOW), false);
    // Emitting an unsigned URL would publish an open endpoint to Instagram.
    assert.equal(cardLinkUrl(BASE, NOW), null);
  } finally {
    if (savedCard !== undefined) process.env.CARD_LINK_SECRET = savedCard;
    if (savedClerk !== undefined) process.env.CLERK_SECRET_KEY = savedClerk;
  }
});

test("the URL carries every field the verifier needs, and a default expiry", () => {
  withKey(() => {
    const out = cardLinkUrl({ turnId: 2730, userId: "user_abc123", size: "x_portrait", format: "webp" }, NOW)!;
    assert.ok(out);
    assert.equal(out.exp, NOW + CARD_LINK_TTL_MS);
    const u = new URL(out.url);
    assert.match(u.pathname, /\/api\/public\/largo-card\/2730$/);
    for (const k of ["u", "size", "format", "exp", "sig"]) {
      assert.ok(u.searchParams.get(k), `missing ${k}`);
    }
    // Round-trip: what the URL says must be what verifies.
    assert.equal(
      verifyCardLink(
        {
          turnId: 2730,
          userId: u.searchParams.get("u")!,
          size: u.searchParams.get("size")!,
          format: u.searchParams.get("format") as "webp",
          exp: Number(u.searchParams.get("exp")),
        },
        u.searchParams.get("sig")!,
        NOW
      ),
      true
    );
  });
});

test("the default TTL is short — the link is slack, not a hosting product", () => {
  // Meta and TikTok fetch within seconds of the publish call. A long window turns a leaked URL
  // into a permanent public mirror of a member's card.
  assert.ok(CARD_LINK_TTL_MS <= 60 * 60 * 1000, "TTL must not exceed an hour");
});

/**
 * THE SIGNED FORMAT MUST BE ONE THE RENDERER CAN ACTUALLY EMIT.
 *
 * This pair was never checked, and drifted apart in the only way that matters: the signer offered
 * `"png" | "jpg"` while `RenderedVisual.contentType` is `"image/png" | "image/webp"`. So a link
 * signed as `jpg` addressed a format the card library cannot produce, and `png` — the only one
 * both sides agreed on — is the format TikTok REJECTS for photo posts (JPEG or WebP only).
 * Every signed link was therefore unrenderable or unpostable, and nothing failed, because no test
 * held the two definitions against each other.
 *
 * Found by reading TikTok's media contract, then confirmed by `tsc` the moment the public route
 * tried to pass a real value through.
 */
test("every signable format is one the renderer emits, and is postable", () => {
  // SET THE KEY EXPLICITLY. `hmacKey()` falls back to CLERK_SECRET_KEY, which exists in this
  // sandbox and does NOT in CI — so the first version of this test passed locally and failed on
  // the runner with "png must be signable", because `cardLinkUrl` correctly returns null with no
  // key material. A test that depends on ambient environment is a test that reports the
  // environment, not the code.
  const saved = process.env.CARD_LINK_SECRET;
  process.env.CARD_LINK_SECRET = "test-signing-key";
  try {
  // The renderer's own union, from `RenderedVisual.contentType`.
    const RENDERABLE = ["png", "webp"] as const;
  // TikTok photo posts: JPEG or WebP. PNG is rejected.
    const TIKTOK_OK = ["webp", "jpg", "jpeg"];

    for (const format of ["png", "webp"] as const) {
      const url = cardLinkUrl({ turnId: 2730, userId: "user_abc123", size: "x_portrait", format }, NOW);
      assert.ok(url, `${format} must be signable`);
      const got = new URL(url!.url).searchParams.get("format")!;
      assert.ok(RENDERABLE.includes(got as (typeof RENDERABLE)[number]), `${got} is not a format the renderer emits`);
  }
  // And at least one signable format survives the platform's own filter — otherwise the link is
  // correct, verifiable, and useless.
    assert.ok(RENDERABLE.some((f) => TIKTOK_OK.includes(f)), "no signable format is postable to TikTok");
  } finally {
    if (saved === undefined) delete process.env.CARD_LINK_SECRET;
    else process.env.CARD_LINK_SECRET = saved;
  }
});
