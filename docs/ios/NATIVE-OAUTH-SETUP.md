# Native Sign in with Google + Apple — TestFlight setup runbook

Native OAuth code path is built. Once you complete the ~4 external steps
below, the app can be rebuilt and shipped to TestFlight and members will
see native Google + Apple buttons on the sign-in / sign-up screens INSIDE
the app that open the SYSTEM auth sheet (not the WebView).

## Why native vs WebView

- **Google**: has blocked WebView OAuth since 2016 (`disallowed_useragent`).
  The only way to get Google Sign-In in an iOS app is the native `GoogleSignIn`
  framework via a Capacitor plugin (opens either the Google iOS app if
  installed, or `ASWebAuthenticationSession` — a real Safari sheet).
- **Apple**: WebView redirect works but the UX is bad (member logs in via web
  form inside the WebView). Native `AuthenticationServices.ASAuthorizationAppleIDProvider`
  fires the Face-ID / passcode sheet directly, which is what Apple's
  Human Interface Guidelines actually want.

## What's already built (this PR)

- `@codetrix-studio/capacitor-google-auth@^3.4.0-rc.4` and
  `@capacitor-community/apple-sign-in@^6.0.0` added to
  `apps/blackout-ios/package.json` and to the web root as
  `optionalDependencies` (so `next build` can resolve the dynamic imports
  the client component uses; run-time resolution still happens in the
  WebView via Capacitor).
- `src/lib/native-oauth/verify-id-token.ts` — verifies Google + Apple
  identity tokens against the providers' JWKS, enforces audience (only
  OUR client IDs allowed), enforces nonce (Apple: SHA-256 hex of the raw
  nonce per Apple's spec).
- `src/lib/native-oauth/clerk-bridge.ts` — looks up / creates the Clerk
  user from the verified identity, mints a `sign_in_tokens` ticket, does
  the FAPI ticket exchange, returns the `__session` + `__client_uat`
  cookies.
- `src/app/api/auth/native-oauth/complete/route.ts` — the endpoint the
  iOS app calls after the native sheet returns an identity token.
- `src/components/auth/NativeOAuthButtons.tsx` — the two buttons, iOS-shell
  only. Calls the Capacitor plugins, sends the token to the endpoint,
  hard-reloads to `/dashboard`.
- `src/components/auth/AuthShell.tsx` — mounts the buttons above the
  Clerk widget; iOS callout copy updated to point at them.
- `apps/blackout-ios/capacitor.config.ts` — GoogleAuth plugin block with
  a placeholder `serverClientId` (real value injected at CI build time).

Nothing else in `next build`, no client-side JS pulled into web bundles
(imports are dynamic and gated by `isIosAppShell()`).

## What YOU do to enable it

Four external steps, ~30 min total. Everything else in the app is ready.

### 1. Google Cloud Console — iOS OAuth client + web OAuth client

Google Sign-In for iOS needs BOTH client IDs configured:
- **iOS OAuth client**: the identity of the iOS app to Google. Its reversed
  form goes into `Info.plist` as a URL scheme.
- **Web OAuth client (server client)**: the identity Clerk trusts as the
  audience. Both client IDs must be in the same Google Cloud project.

1. https://console.cloud.google.com → APIs & Services → Credentials
2. **Create OAuth 2.0 Client ID** → **iOS**:
   - Bundle ID: `com.blackouttrades.app` (or the actual bundle from
     `capacitor.config.ts:appId`; note the Apple ASC bundle is
     `com.blackout-trades.app` per the config comment — use whichever
     matches the shipped `.ipa`)
   - Copy the client ID (looks like `1234567890-abc.apps.googleusercontent.com`)
3. **Create OAuth 2.0 Client ID** → **Web application**:
   - Authorized redirect URIs: `https://clerk.blackouttrades.com/v1/oauth_callback`
     (only needed if we ever expose Google in Clerk dashboard too — safe to
     leave for now)
   - Copy this client ID as well

### 2. Apple Developer — Sign in with Apple capability + Services ID

Same as the Apple sign-in path A runbook (`APPLE-SIGNIN-SETUP.md`) — the
Services ID + .p8 key + Team ID + Key ID work for BOTH the native and the
WebView redirect flows. If you already did that runbook, skip to step 3.

Additional native-only requirement:
- On the App ID (`com.blackouttrades.app`), enable **Sign in with Apple**
  capability (Certificates, Identifiers & Profiles → your App ID → Edit → check
  Sign in with Apple, Save).
- Regenerate the provisioning profile (Codemagic pulls new profiles
  automatically on next build).

### 3. Add secrets to CI (Codemagic env vars for the iOS build)

Set these in the Codemagic workflow env or repository-level secrets:

    NATIVE_OAUTH_GOOGLE_IOS_CLIENT_ID       // step 1 iOS client ID
    NATIVE_OAUTH_GOOGLE_SERVER_CLIENT_ID    // step 1 web client ID
    NATIVE_OAUTH_APPLE_SERVICES_ID          // step 2 Services ID

The build script needs to:
- Inject `NATIVE_OAUTH_GOOGLE_SERVER_CLIENT_ID` into `capacitor.config.ts`'s
  `plugins.GoogleAuth.serverClientId` field.
- Inject `NATIVE_OAUTH_GOOGLE_IOS_CLIENT_ID` reversed form into
  `ios/App/App/Info.plist` as a `CFBundleURLScheme` (Google iOS SDK
  requires a URL scheme of the reversed client ID for the callback).
- Enable the Sign in with Apple entitlement in the Xcode signing config.

Concretely, add to `apps/blackout-ios/codemagic.yaml` env block:

    scripts:
      - name: Native OAuth config injection
        script: |
          # Replace placeholder in capacitor.config.ts
          sed -i '' "s/GOOGLE_SERVER_CLIENT_ID_INJECTED_AT_BUILD/${NATIVE_OAUTH_GOOGLE_SERVER_CLIENT_ID}/" capacitor.config.ts
          # Add reversed Google client ID URL scheme to Info.plist
          REVERSED=$(echo "$NATIVE_OAUTH_GOOGLE_IOS_CLIENT_ID" | awk -F. '{for (i=NF; i>=1; i--) printf "%s%s", $i, (i==1 ? "" : ".")}')
          /usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string $REVERSED" ios/App/App/Info.plist || \
            /usr/libexec/PlistBuddy -c "Set :CFBundleURLTypes:0:CFBundleURLSchemes:0 $REVERSED" ios/App/App/Info.plist

### 4. Add secrets to prod web env (ECS task definition)

For the `/api/auth/native-oauth/complete` endpoint to accept tokens:

    NATIVE_OAUTH_GOOGLE_IOS_CLIENT_IDS      // comma-separated; usually just
                                             // one value = the iOS client ID
                                             // from step 1
    NATIVE_OAUTH_APPLE_CLIENT_IDS           // comma-separated; the Services ID
                                             // from step 2

These are the AUDIENCE values the endpoint accepts. Any token with a
different `aud` is rejected — that's the security gate.

Add them to `blackout-infra/ecs/tasks/blackout-web.json` (or equivalent
Terraform module) alongside CLERK_SECRET_KEY.

## Test after deploy

1. Rebuild the iOS app via Codemagic (the CI script bakes the client IDs
   into Info.plist + capacitor.config).
2. Ship to TestFlight.
3. Open the app, tap "Sign in", tap "Sign in with Google" or "Sign in with
   Apple".
4. Expected: the SYSTEM auth sheet opens (NOT a WebView) — Google's
   system-level sheet or Apple's Face-ID prompt.
5. Complete auth. App reloads to `/dashboard` signed in.

## If it fails

- **Google**: "The app is not authorized to use this feature" → iOS OAuth
  client bundle ID doesn't match the shipped `.ipa` bundle. Google Cloud
  Console → Credentials → iOS client → verify bundle.
- **Apple**: "Sign in with Apple failed" → App ID entitlement not enabled OR
  Services ID not configured. Apple Developer → App ID → verify capability
  checked. Codemagic build log should show `Sign in with Apple` entitlement
  in the signing step.
- **Endpoint rejects with 401 verify_failed**: audience mismatch. Verify
  `NATIVE_OAUTH_GOOGLE_IOS_CLIENT_IDS` / `NATIVE_OAUTH_APPLE_CLIENT_IDS` in
  ECS env match the exact client IDs from Google Cloud / Apple Developer.

## What happens on WEB after this ships

Nothing. `NativeOAuthButtons` returns `null` outside the iOS shell
(`isIosAppShell()` false). The web sign-in page keeps its existing Clerk
widget with Discord (and Google if you enable it via Clerk dashboard using
the WEB OAuth client from step 1). Zero regressions on the marketing site.
