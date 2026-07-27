"use client";

/**
 * Native Sign-in with Google / Apple buttons — only mount inside the iOS
 * Capacitor WebView. On tap, calls the appropriate Capacitor plugin to open
 * the SYSTEM auth sheet (Google's disallowed_useragent block doesn't apply
 * to native SDKs; Apple's ASAuthorizationAppleIDProvider gives the Face-ID /
 * passcode sheet). Plugin returns an identity token, we POST it to
 * /api/auth/native-oauth/complete which verifies + mints a Clerk session
 * cookie. Then hard-reload to /dashboard so the WKWebView picks up the new
 * cookie state.
 *
 * DOES NOT LOAD ON THE WEB. The Capacitor plugin imports are dynamic() so
 * the desktop / mobile-web bundles don't ship the native code. `isIosAppShell()`
 * guards the mount so the buttons never appear off-device.
 *
 * The Clerk widget's own social buttons keep working for Discord (which does
 * ride the WebView OAuth fine); these NATIVE buttons only handle Google + Apple
 * where the WebView flow either fails (Google) or is UX-worse than the system
 * sheet (Apple).
 */

import { useEffect, useState } from "react";
import { isIosAppShell } from "@/lib/ios-app-shell";

type Status = "idle" | "google" | "apple" | "error";

function generateNonce(): string {
  // 32 hex chars — Apple wants the raw nonce SHA-256'd server-side; Google
  // takes the raw string. Crypto-random via WebCrypto (available in Capacitor
  // WebView + all modern browsers).
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function completeSignIn(payload: Record<string, unknown>): Promise<void> {
  const res = await fetch("/api/auth/native-oauth/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; redirectTo?: string; message?: string };
  if (!res.ok || !json.ok) {
    throw new Error(json.message || `bridge failed with status ${res.status}`);
  }
  // Hard reload so the fresh __session cookie is included on the next document
  // load — SPA-nav wouldn't re-hit SSR with the new cookie in time.
  window.location.assign(json.redirectTo || "/dashboard");
}

async function signInWithGoogle(): Promise<void> {
  // Dynamic import — keeps the plugin out of the web bundle. The plugin
  // package resolves to a no-op stub on non-native platforms but we still
  // don't want it pulled into the main chunk for members on web.
  const mod = await import(
    /* webpackChunkName: "native-google-auth" */
    "@codetrix-studio/capacitor-google-auth"
  ).catch(() => null);
  if (!mod?.GoogleAuth) {
    throw new Error("Google Sign-In plugin not available");
  }
  // Plugin auto-initializes from capacitor.config.ts on iOS; explicit
  // .initialize() is a no-op for us but safe to call.
  try {
    await mod.GoogleAuth.initialize({});
  } catch {
    /* already initialized */
  }
  const result = await mod.GoogleAuth.signIn();
  const idToken = result?.authentication?.idToken;
  if (!idToken) throw new Error("Google Sign-In returned no idToken");
  await completeSignIn({ provider: "google", idToken });
}

async function signInWithApple(): Promise<void> {
  const mod = await import(
    /* webpackChunkName: "native-apple-signin" */
    "@capacitor-community/apple-sign-in"
  ).catch(() => null);
  if (!mod?.SignInWithApple) {
    throw new Error("Apple Sign-In plugin not available");
  }
  const rawNonce = generateNonce();
  const result = await mod.SignInWithApple.authorize({
    // clientId + redirectURI can be empty for native flow — Apple pulls them
    // from the app's entitlement + Info.plist. The web browser fallback path
    // (not used here) would need them set.
    clientId: process.env.NEXT_PUBLIC_APPLE_SERVICES_ID || "",
    redirectURI: process.env.NEXT_PUBLIC_APPLE_REDIRECT_URI || "",
    scopes: "email name",
    state: rawNonce,
    nonce: rawNonce,
  });
  const idToken: string | undefined = result?.response?.identityToken;
  if (!idToken) throw new Error("Apple Sign-In returned no identityToken");
  await completeSignIn({
    provider: "apple",
    idToken,
    rawNonce,
    // First-touch fields (Apple sends these ONLY on the first sign-in, then
    // hides them behind the private-relay). We forward them so the server
    // can attach the email + display name to the freshly-created Clerk user.
    fallbackEmail: result?.response?.email || undefined,
    fallbackName:
      [result?.response?.givenName, result?.response?.familyName].filter(Boolean).join(" ") || undefined,
  });
}

export function NativeOAuthButtons() {
  const [iosApp, setIosApp] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setIosApp(isIosAppShell());
  }, []);

  if (!iosApp) return null;

  const busy = status === "google" || status === "apple";

  async function handle(provider: "google" | "apple") {
    setStatus(provider);
    setErrorMsg(null);
    try {
      if (provider === "google") await signInWithGoogle();
      else await signInWithApple();
      // On success we've already navigated — component unmounts.
    } catch (err) {
      setStatus("error");
      const msg = err instanceof Error ? err.message : String(err);
      // Suppress user-cancelled — Google plugin throws "The user canceled",
      // Apple throws code 1001 / "cancelled".
      if (/cancel|user canceled|1001/i.test(msg)) {
        setStatus("idle");
        return;
      }
      setErrorMsg(msg);
    }
  }

  return (
    <div className="native-oauth-buttons flex flex-col gap-2.5 mb-3">
      <button
        type="button"
        aria-label="Sign in with Apple"
        disabled={busy}
        onClick={() => handle("apple")}
        className="flex items-center justify-center gap-2 rounded-lg bg-white text-black font-syne text-sm font-semibold py-3 px-4 disabled:opacity-60"
      >
        {status === "apple" ? (
          <span className="font-mono text-xs">Signing in…</span>
        ) : (
          <>
            <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.05 12.04c-.02-2.6 2.13-3.85 2.22-3.91-1.21-1.77-3.1-2.02-3.77-2.05-1.6-.17-3.13.95-3.94.95-.83 0-2.08-.93-3.42-.9-1.76.03-3.38 1.02-4.28 2.6-1.83 3.17-.47 7.86 1.31 10.42.87 1.25 1.9 2.66 3.24 2.61 1.31-.05 1.8-.85 3.38-.85 1.57 0 2.02.85 3.4.82 1.4-.02 2.29-1.28 3.14-2.54 1-1.46 1.41-2.87 1.43-2.94-.03-.02-2.74-1.05-2.71-4.17M14.68 4.4c.72-.87 1.2-2.08 1.07-3.28-1.03.04-2.28.68-3.02 1.55-.67.77-1.24 2-1.09 3.18 1.15.09 2.32-.58 3.04-1.45"/>
            </svg>
            Sign in with Apple
          </>
        )}
      </button>
      <button
        type="button"
        aria-label="Sign in with Google"
        disabled={busy}
        onClick={() => handle("google")}
        className="flex items-center justify-center gap-2 rounded-lg bg-[#131418] border border-white/10 text-white font-syne text-sm font-semibold py-3 px-4 disabled:opacity-60"
      >
        {status === "google" ? (
          <span className="font-mono text-xs">Signing in…</span>
        ) : (
          <>
            <svg aria-hidden width="16" height="16" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.25 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Sign in with Google
          </>
        )}
      </button>
      {errorMsg && (
        <p role="alert" className="font-mono text-[10px] text-bear px-1">
          Sign-in failed: {errorMsg}
        </p>
      )}
      <p className="font-mono text-[10px] text-secondary text-center mt-1 opacity-80">
        or use Discord / email + code below
      </p>
    </div>
  );
}
