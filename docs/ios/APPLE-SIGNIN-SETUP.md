# Sign in with Apple — enable path

Apple sign-in is NOT enabled in the Clerk instance today (checked live via
Clerk FAPI `/v1/environment` — providers list shows only `oauth_discord` +
`oauth_google`). Once you enable it in the Clerk dashboard + Apple Developer,
the button shows up on **both** the website and the iOS WebView shell
automatically — the code path is already wired (this branch un-hides Apple
in the iOS-shell CSS; only Google stays hidden because Google is the only
provider Apple/Google policy actually blocks in WKWebView).

You (the owner) do this once. I can't do it — it needs your Apple Developer
account and Clerk dashboard access.

## Path A — Web + iOS WebView (redirect flow, ~10 min)

This is the "just works" path. Apple's OAuth page opens INSIDE the WebView,
user authenticates with Apple, redirect returns to Clerk, Clerk returns to
blackouttrades.com. Same navigation the WebView already handles for every
other link.

### 1. Apple Developer — Services ID + Sign in with Apple key

1. https://developer.apple.com → Certificates, Identifiers & Profiles → Identifiers
2. **Register a new Services ID** (not an App ID):
   - Description: `BlackOut Trades — Sign in with Apple`
   - Identifier: `com.blackouttrades.signin` (this becomes the OAuth `client_id`)
   - Enable **Sign in with Apple** capability
   - Configure it:
     - Primary App ID: your existing `com.blackouttrades.app` (or whatever
       the iOS TestFlight app's bundle ID is — check `apps/blackout-ios/capacitor.config.ts`)
     - Domains and Subdomains: `clerk.blackouttrades.com`
     - Return URLs: `https://clerk.blackouttrades.com/v1/oauth_callback`
3. **Create a Sign in with Apple key** (Keys tab):
   - New key, name `Clerk Apple Sign In`
   - Enable **Sign in with Apple**, associate with your primary App ID
   - Download the `.p8` private key file (Apple lets you download it ONCE — save it)
   - Note the **Key ID** (10 chars)
4. Grab your **Team ID** from the top-right of the Apple Developer portal (10 chars)

### 2. Clerk dashboard — enable Apple provider

1. https://dashboard.clerk.com → BlackOut instance → User & Authentication → Social Connections
2. Click **Add connection** → **Apple**
3. Enter:
   - **Services ID (Client ID)**: `com.blackouttrades.signin` (from step 1.2)
   - **Team ID**: (from step 1.4)
   - **Key ID**: (from step 1.3)
   - **Private key**: paste the entire `.p8` file contents
4. Save

That's it for path A. The Apple button appears on the sign-in / sign-up pages
on web AND inside the iOS WebView (Google stays hidden because it's the only
provider that actually breaks there). Reload the WebView after saving; no
app rebuild needed.

## Path B — native Sign in with Apple (bonus, ~1 day of engineering)

Optional upgrade: instead of the WebView opening Apple's web login page,
tap "Sign in with Apple" fires the iOS system-level Face ID / passcode
sheet directly. Much better UX, and Apple actually PREFERS this — apps
that offer email + Apple ID get faster App Store review.

Steps (for a follow-up PR I'd open):
1. `npm i @capacitor-community/apple-sign-in` in `apps/blackout-ios/`
2. Enable **Sign in with Apple** capability in `App.entitlements`
3. Enable the same capability on the App ID in Apple Developer
4. Add a `SignInWithApple` component that:
   - Only mounts inside the iOS shell (checks `isIosAppShell()`)
   - On tap: calls `SignInWithApple.authorize({...})` (Capacitor plugin)
   - Sends the returned `identityToken` to a new endpoint
     `POST /api/auth/apple-native/complete`
5. Server endpoint uses Clerk Backend API's `create_sign_in_token`
   with the Apple identityToken as an external-account credential.
6. Ship a new TestFlight build.

Path A works on its own; Path B is a UX polish for a future TestFlight
build. Do Path A first — it's zero-code from here since the CSS is already
prepared.

## Where the code is prepared

- `src/app/globals.css:15-30` — only `.cl-socialButtonsBlockButton__google`
  and `.cl-socialButtonsIconButton__google` are hidden in the iOS shell now.
  Apple (and Discord, and anything else Clerk lists) all show through.
- `src/components/auth/AuthShell.tsx:145-155` — the iOS callout copy
  reflects "Discord, Apple, or email + one-time code" (Apple listed
  optimistically so the moment path A completes the copy is accurate;
  if Apple takes longer to enable than expected the callout still reads
  correctly for "Discord or email").
