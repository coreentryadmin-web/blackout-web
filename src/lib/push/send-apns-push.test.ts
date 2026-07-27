import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateKeyPairSync, createVerify } from "node:crypto";
import {
  apnsConfigured,
  buildApnsBody,
  jwtIsFresh,
  mintApnsJwt,
  type ApnsConfig,
} from "./send-apns-push";

// Generate a real P-256 key pair once so the JWT signature test verifies with
// the paired public key — proves the sign path is correct WITHOUT needing the
// real APNs key. This is the identical curve/algorithm APNs requires (ES256).
function makeTestKeypair() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return {
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    publicKey,
  };
}

const TEST_CFG = (privateKey: string): ApnsConfig => ({
  teamId: "ABCDE12345",
  keyId: "KEYID12345",
  privateKey,
  bundleId: "com.blackout-trades.app",
  host: "api.push.apple.com",
});

describe("mintApnsJwt", () => {
  it("produces a 3-part token with a valid ES256 signature over header.payload", () => {
    const { privateKeyPem, publicKey } = makeTestKeypair();
    const now = 1_700_000_000;
    const jwt = mintApnsJwt(TEST_CFG(privateKeyPem), now);
    const parts = jwt.split(".");
    assert.equal(parts.length, 3, "JWT must be three base64url parts");

    // Header + payload correctness — kid, iss, alg=ES256, iat=now.
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    assert.equal(header.alg, "ES256");
    assert.equal(header.kid, "KEYID12345");
    assert.equal(header.typ, "JWT");
    assert.equal(payload.iss, "ABCDE12345");
    assert.equal(payload.iat, now);

    // Signature verifies against the paired public key. This is the load-
    // bearing assertion — if this fails, APNs will reject every request.
    // Node's default signature encoding is DER; the sender emits ieee-p1363
    // (r||s, 64 bytes) to match JOSE. Verify with the same flag.
    const verifier = createVerify("SHA256");
    verifier.update(`${parts[0]}.${parts[1]}`);
    const sig = Buffer.from(parts[2], "base64url");
    assert.equal(sig.length, 64, "ES256 JOSE signature must be 64 bytes (r||s)");
    const ok = verifier.verify({ key: publicKey, dsaEncoding: "ieee-p1363" }, sig);
    assert.ok(ok, "signature must verify against the paired public key");
  });

  it("uses the provided nowSeconds so callers can pin iat for tests / batching", () => {
    const { privateKeyPem } = makeTestKeypair();
    const iat = 1_600_000_000;
    const jwt = mintApnsJwt(TEST_CFG(privateKeyPem), iat);
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
    assert.equal(payload.iat, iat);
  });
});

describe("apnsConfigured", () => {
  it("is false when any required env var is missing", () => {
    // Snapshot + clear the real env for the duration of the test so this
    // works whether or not the operator has real APNs creds set locally.
    const originals = {
      APNS_TEAM_ID: process.env.APNS_TEAM_ID,
      APNS_KEY_ID: process.env.APNS_KEY_ID,
      APNS_PRIVATE_KEY: process.env.APNS_PRIVATE_KEY,
      APNS_BUNDLE_ID: process.env.APNS_BUNDLE_ID,
    };
    try {
      delete process.env.APNS_TEAM_ID;
      delete process.env.APNS_KEY_ID;
      delete process.env.APNS_PRIVATE_KEY;
      delete process.env.APNS_BUNDLE_ID;
      assert.equal(apnsConfigured(), false);

      process.env.APNS_TEAM_ID = "ABCDE12345";
      assert.equal(apnsConfigured(), false, "only team id → not configured");

      process.env.APNS_KEY_ID = "KEYID12345";
      process.env.APNS_PRIVATE_KEY = "not-a-real-key-but-nonempty";
      process.env.APNS_BUNDLE_ID = "com.blackout-trades.app";
      assert.equal(apnsConfigured(), true, "all four set → configured");

      process.env.APNS_BUNDLE_ID = "   ";
      assert.equal(apnsConfigured(), false, "whitespace-only bundle id is not a value");
    } finally {
      for (const [k, v] of Object.entries(originals)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});

describe("buildApnsBody", () => {
  it("shapes the aps dictionary with alert + user-info at top level", () => {
    const raw = buildApnsBody({
      title: "SPX bullish setup confirmed",
      body: "Reclaimed VWAP + call aggression.",
      sound: "default",
      badge: 3,
      category: "signal.confirmed",
      interruptionLevel: "time-sensitive",
      userInfo: { signalId: "sig_123", ticker: "SPX" },
    });
    const parsed = JSON.parse(raw);
    assert.deepEqual(parsed.aps.alert, {
      title: "SPX bullish setup confirmed",
      body: "Reclaimed VWAP + call aggression.",
    });
    assert.equal(parsed.aps.sound, "default");
    assert.equal(parsed.aps.badge, 3);
    assert.equal(parsed.aps.category, "signal.confirmed");
    // Apple spec: "interruption-level" is kebab-case in the JSON, not camel.
    assert.equal(parsed.aps["interruption-level"], "time-sensitive");
    // userInfo fields land at the TOP level alongside aps, not inside it —
    // that's how the app extracts them from the notification payload.
    assert.equal(parsed.signalId, "sig_123");
    assert.equal(parsed.ticker, "SPX");
  });

  it("omits absent aps keys instead of sending nulls", () => {
    const raw = buildApnsBody({ title: "just title" });
    const parsed = JSON.parse(raw);
    assert.equal(parsed.aps.alert.title, "just title");
    assert.equal("body" in parsed.aps.alert, false);
    assert.equal("sound" in parsed.aps, false);
    assert.equal("badge" in parsed.aps, false);
    assert.equal("category" in parsed.aps, false);
    assert.equal("interruption-level" in parsed.aps, false);
  });

  it("supports silent/data-only pushes (no alert dict)", () => {
    const raw = buildApnsBody({ userInfo: { refresh: true } });
    const parsed = JSON.parse(raw);
    assert.equal("alert" in parsed.aps, false);
    assert.equal(parsed.refresh, true);
  });
});

describe("jwtIsFresh", () => {
  it("is true within the 45-minute lifetime window", () => {
    assert.equal(jwtIsFresh(1_000_000, 1_000_000), true, "just minted");
    assert.equal(jwtIsFresh(1_000_000, 1_000_000 + 44 * 60), true, "44 min later");
    assert.equal(jwtIsFresh(1_000_000, 1_000_000 + 46 * 60), false, "46 min later — stale");
  });
});
