import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * PERMISSIONS-POLICY — the header that silently disabled Largo's voice input on desktop.
 *
 * THE BUG. The app shipped `Permissions-Policy: microphone=()`. An EMPTY allowlist does not mean
 * "default"; it means the microphone is disabled for EVERY origin, including our own. Chrome on
 * desktop enforces this for the Web Speech API, so `SpeechRecognition.start()` failed before a
 * permission prompt could ever appear and the mic button looked dead.
 *
 * WHY IT SURVIVED REVIEW AND TESTING. Safari on iOS routes SpeechRecognition through system
 * dictation and does not gate it on the same policy, so the IDENTICAL build worked on a phone and
 * failed on a PC. The difference was a response header, not a line of component code — no amount
 * of reading the component would have found it, and no test looked at headers at all.
 *
 * This is that test. It pins both halves of the policy, because both are load-bearing:
 * the grant that makes the feature work, and the locks that must not loosen with it.
 */

async function policyFor(source: string): Promise<string> {
  const cfg = (await import("../next.config.mjs")).default as {
    headers: () => Promise<Array<{ source: string; headers: Array<{ key: string; value: string }> }>>;
  };
  const entries = await cfg.headers();
  const entry = entries.find((e) => e.source === source);
  assert.ok(entry, `no header entry for ${source}`);
  const header = entry!.headers.find((h) => h.key === "Permissions-Policy");
  assert.ok(header, `no Permissions-Policy on ${source}`);
  return header!.value;
}

/** The catch-all rule that covers every app page, including /terminal where Largo lives. */
const APP_SOURCE = "/((?!embed/|_next/).*)";

test("the app origin is GRANTED the microphone — Largo's voice input depends on it", async () => {
  const policy = await policyFor(APP_SOURCE);
  assert.match(
    policy,
    /microphone=\(self\)/,
    "microphone must be granted to self; `microphone=()` disables it for our own origin too and " +
      "kills dictation on desktop Chrome while still appearing to work on iOS Safari"
  );
});

test("camera, geolocation and payment stay fully disabled", async () => {
  const policy = await policyFor(APP_SOURCE);
  // The mic grant is the ONLY loosening. If a future edit widens these by copying the pattern,
  // this fails.
  for (const feature of ["camera", "geolocation", "payment"]) {
    assert.match(
      policy,
      new RegExp(`${feature}=\\(\\)`),
      `${feature} must remain disabled for every origin`
    );
  }
});

test("embed routes keep the microphone fully disabled", async () => {
  // /embed/* is public, unauthenticated, and deliberately framed on arbitrary third-party sites
  // (frame-ancestors *). Nothing there needs a microphone, and the app-wide grant must not reach
  // it by inheritance if that page ever grows client code.
  const policy = await policyFor("/embed/:path*");
  assert.match(policy, /microphone=\(\)/, "embeds must not inherit the microphone grant");
  assert.doesNotMatch(policy, /microphone=\(self\)/);
});
