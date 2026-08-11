import test from "node:test";
import assert from "node:assert/strict";
import { pickPrivacy, tiktokEnabled, tiktokPublishMode, type TikTokPrivacy } from "./tiktok-api";

/**
 * The network calls need TikTok credentials and a verified domain, so what is tested here is the
 * DECISION logic — which is where an automated poster can actually hurt you. A wrong privacy level
 * or a silently-promoted publish mode is a post going somewhere nobody intended.
 */

test("absent credentials mean SKIP, not error", () => {
  // Mirrors `xApiEnabled()`. This is what lets the module ship dark — merged, deployed and inert —
  // before any TikTok app review exists.
  const saved = process.env.TIKTOK_ACCESS_TOKEN;
  delete process.env.TIKTOK_ACCESS_TOKEN;
  assert.equal(tiktokEnabled(), false);
  process.env.TIKTOK_ACCESS_TOKEN = "t";
  assert.equal(tiktokEnabled(), true);
  if (saved === undefined) delete process.env.TIKTOK_ACCESS_TOKEN;
  else process.env.TIKTOK_ACCESS_TOKEN = saved;
});

test("publish mode defaults to INBOX and only `direct` promotes it", () => {
  // Direct Post requires TikTok's app audit; before it, direct posts are silently self-only. And
  // nothing should go out unattended while copy generation is still being tuned.
  const saved = process.env.TIKTOK_PUBLISH_MODE;
  for (const v of [undefined, "", "DIRECT", "live", "true", "inbox"]) {
    if (v === undefined) delete process.env.TIKTOK_PUBLISH_MODE;
    else process.env.TIKTOK_PUBLISH_MODE = v;
    assert.equal(tiktokPublishMode(), "inbox", `"${v}" must not promote to direct`);
  }
  process.env.TIKTOK_PUBLISH_MODE = "direct";
  assert.equal(tiktokPublishMode(), "direct");
  if (saved === undefined) delete process.env.TIKTOK_PUBLISH_MODE;
  else process.env.TIKTOK_PUBLISH_MODE = saved;
});

test("privacy defaults to the NARROWEST level the creator allows", () => {
  // An automated poster that defaults to the widest available option is one misconfiguration away
  // from broadcasting something unintended. The caller can always ask for wider explicitly.
  const all: TikTokPrivacy[] = ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"];
  assert.equal(pickPrivacy(all), "SELF_ONLY");
  assert.equal(pickPrivacy(["PUBLIC_TO_EVERYONE", "FOLLOWER_OF_CREATOR"]), "FOLLOWER_OF_CREATOR");
  assert.equal(pickPrivacy(["PUBLIC_TO_EVERYONE"]), "PUBLIC_TO_EVERYONE");
});

test("an explicit ask the creator FORBIDS is a skip, never a silent downgrade", () => {
  // TikTok rejects a publish whose privacy level the creator disallows. Quietly substituting a
  // different level would post something the caller did not ask for, which is worse than posting
  // nothing — so this returns null and the caller skips.
  assert.equal(pickPrivacy(["SELF_ONLY"], "PUBLIC_TO_EVERYONE"), null);
  assert.equal(pickPrivacy(["SELF_ONLY"], "SELF_ONLY"), "SELF_ONLY");
});

test("a creator who allows NOTHING yields null rather than a guess", () => {
  assert.equal(pickPrivacy([]), null);
  assert.equal(pickPrivacy([], "PUBLIC_TO_EVERYONE"), null);
});
