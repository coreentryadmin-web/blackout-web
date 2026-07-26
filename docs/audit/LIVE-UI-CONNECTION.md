# Connecting to the Live UI from the Cloud Sandbox

This document covers every method for reaching the live BlackOut Trades UI
(both `blackouttrades.com` and `staging.blackouttrades.com`) from the Claude
Code cloud sandbox. All methods work through the agent proxy at
`http://127.0.0.1:39619`.

---

## 1. Browser screenshots (Playwright proxy bridge)

**What it does:** Full Chromium rendering — JS execution, CSS paint, canvas,
screenshots, click flows. The browser runs locally; every network request is
intercepted and tunneled through the agent proxy manually.

**Why it exists:** Chromium's built-in CONNECT tunneling fails against the
agent proxy (BoringSSL handshake reset). The bridge sidesteps this by never
letting Chromium make its own HTTPS connections.

**Script:** `scripts/proxy-browser.cjs`

### PC viewport (default)

```bash
node scripts/proxy-browser.cjs https://blackouttrades.com \
  --viewport 1440x900 \
  --out /tmp/desktop-home.png
```

### Mobile viewport (iPhone)

```bash
node scripts/proxy-browser.cjs https://blackouttrades.com \
  --viewport 393x852 \
  --out /tmp/mobile-home.png
```

### iOS app shell (adds BlackOutiOSApp user-agent)

```bash
node scripts/proxy-browser.cjs https://blackouttrades.com \
  --viewport 393x852 \
  --ua "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) BlackOutiOSApp" \
  --out /tmp/ios-shell.png
```

### Common pages to check

| Page               | URL                                                  |
|--------------------|------------------------------------------------------|
| Homepage           | `https://blackouttrades.com`                         |
| Pricing            | `https://blackouttrades.com/pricing`                 |
| Vector (chart)     | `https://blackouttrades.com/desk/vector`             |
| Helix (flow)       | `https://blackouttrades.com/desk/helix`              |
| Thermal (heatmap)  | `https://blackouttrades.com/desk/thermal`            |
| Night Hawk (0DTE)  | `https://blackouttrades.com/desk/night-hawk`         |
| Largo (AI)         | `https://blackouttrades.com/desk/largo`              |
| Upgrade            | `https://blackouttrades.com/upgrade`                 |
| Learn              | `https://blackouttrades.com/learn`                   |
| Staging homepage   | `https://staging.blackouttrades.com`                 |
| Staging Vector     | `https://staging.blackouttrades.com/desk/vector`     |

### Programmatic use (inside another script)

```js
const { renderPage, fetchViaProxy } = require('./scripts/proxy-browser.cjs');

// Screenshot
await renderPage({
  url: 'https://blackouttrades.com/desk/vector',
  viewport: { width: 1440, height: 900 },
  out: '/tmp/vector-desktop.png',
});

// Raw fetch (no browser, just HTTP through the proxy)
const res = await fetchViaProxy('https://blackouttrades.com/api/health');
console.log(res.status, res.body.toString());
```

---

## 2. Authenticated pages (Clerk session cookie)

Unauthenticated screenshots show the public site (sign-in buttons, marketing
pages). To see what a logged-in premium member sees (desk tools, account
pages), mint a temporary Clerk session first.

### Step-by-step

1. **Mint a temp admin+premium user** via Clerk Backend API.
2. **Exchange for a session cookie** via FAPI ticket flow.
3. **Pass the cookie to the browser** or to raw HTTP fetches.
4. **Always delete the temp user** when done.

### Using the committed helper

```js
import { mintClerkPremiumSession } from './scripts/audit/lib/prod-clerk-session.mjs';

const session = await mintClerkPremiumSession({
  appUrl: 'https://blackouttrades.com',   // or staging.blackouttrades.com
});

if (session.skip) {
  console.log('Auth skipped:', session.reason);
} else {
  // session.cookieHeader = "__session=<jwt>; __client_uat=<epoch>"
  // Use with fetchViaProxy:
  const { fetchViaProxy } = require('./scripts/proxy-browser.cjs');
  const res = await fetchViaProxy('https://blackouttrades.com/desk/vector', {
    cookie: session.cookieHeader,
  });

  // Always clean up
  await session.cleanup();
}
```

### Required env vars

| Variable                              | Where to get it                     |
|---------------------------------------|-------------------------------------|
| `CLERK_SECRET_KEY`                    | Already set in sandbox env          |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`   | Already set in sandbox env          |

No manual phone number needed — `generateDefaultAuditPhone()` in
`scripts/audit/lib/audit-phone.mjs` produces a unique `+1415555XXXX` per run.

### Raw curl version (no Node)

```bash
# 1. Create temp user
USER_ID=$(curl -s https://api.clerk.com/v1/users \
  -H "Authorization: Bearer $CLERK_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email_address":["claude-audit-temp@blackouttrades.com"],
       "phone_number":["+14155550199"],
       "public_metadata":{"role":"admin","tier":"premium"},
       "skip_password_requirement":true,
       "skip_legal_checks":true}' | jq -r '.id')

# 2. Mint sign-in token
TICKET=$(curl -s https://api.clerk.com/v1/sign_in_tokens \
  -H "Authorization: Bearer $CLERK_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"user_id\":\"$USER_ID\"}" | jq -r '.token')

# 3. Exchange ticket for session (captures cookies)
SIGN_IN=$(curl -s -c /tmp/clerk.jar \
  "https://clerk.blackouttrades.com/v1/client/sign_ins?_clerk_js_version=5.57.0" \
  -H "Origin: https://blackouttrades.com" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "strategy=ticket&ticket=$TICKET")
SESSION_ID=$(echo "$SIGN_IN" | jq -r '.response.created_session_id')

# 4. Mint session JWT
JWT=$(curl -s -b /tmp/clerk.jar \
  "https://clerk.blackouttrades.com/v1/client/sessions/$SESSION_ID/tokens?_clerk_js_version=5.57.0" \
  -X POST \
  -H "Origin: https://blackouttrades.com" | jq -r '.jwt')

# 5. Fetch any authenticated page
curl -s https://blackouttrades.com/desk/vector \
  -H "Cookie: __session=$JWT; __client_uat=$(date +%s)"

# 6. ALWAYS delete the temp user
curl -s -X DELETE "https://api.clerk.com/v1/users/$USER_ID" \
  -H "Authorization: Bearer $CLERK_SECRET_KEY"
```

---

## 3. Headless HTML fetch (no browser needed)

For checks that only need the served HTML/DOM (not rendered pixels), skip
the browser entirely and use `fetchViaProxy` or plain curl.

### With fetchViaProxy (Node)

```js
const { fetchViaProxy } = require('./scripts/proxy-browser.cjs');
const res = await fetchViaProxy('https://blackouttrades.com/api/health');
console.log(res.status, res.body.toString());
```

### With curl

```bash
curl -s https://blackouttrades.com/api/health
curl -s https://blackouttrades.com | head -100
```

Curl works natively through the agent proxy (HTTPS_PROXY is set). No special
setup needed.

---

## 4. API endpoint validation

All REST/SSE endpoints work via curl or fetch. Examples:

```bash
# Health check
curl -s https://blackouttrades.com/api/health

# Vector GEX data (authenticated)
curl -s https://blackouttrades.com/api/vector/gex?ticker=SPX \
  -H "Cookie: __session=$JWT; __client_uat=$(date +%s)"

# Staging API
curl -s https://staging.blackouttrades.com/api/health
```

---

## 5. Committed E2E suites (run these, don't reinvent)

| Suite                     | Command                               | What it validates                              |
|---------------------------|---------------------------------------|------------------------------------------------|
| Vector push gate          | `npm run validate:vector-push-gate`   | Chart + GEX + spot + terminal + regime render  |
| Vector hardcore           | `npm run validate:vector-hardcore`    | Actual values + dynamism + wall/bead rail       |
| iOS UI E2E                | `npm run test:ios-ui-e2e`             | Mobile shell + tab bar + segments               |
| Data validator            | `node scripts/audit/data-validator.mjs` | Cross-provider number accuracy                |

All use `env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY` so
`~/.aws/credentials` is used instead of the sandbox's placeholder env vars.

---

## What does NOT work

| Method                      | Why                                            |
|-----------------------------|------------------------------------------------|
| Raw WebSocket connections   | Agent proxy doesn't support WS upgrades        |
| Direct Postgres (TCP)      | Only HTTP(S) egress through the proxy           |
| Chromium `--proxy-server`  | BoringSSL handshake rejected; use proxy bridge  |
| Firefox                     | Not installed in this sandbox                   |

---

## Quick-reference: one-liners

```bash
# Desktop screenshot of homepage
node scripts/proxy-browser.cjs https://blackouttrades.com --viewport 1440x900 --out /tmp/desktop.png

# Mobile screenshot of Vector
node scripts/proxy-browser.cjs https://blackouttrades.com/desk/vector --viewport 393x852 --out /tmp/vector-mobile.png

# iOS app shell screenshot
node scripts/proxy-browser.cjs https://blackouttrades.com --viewport 393x852 --ua "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) BlackOutiOSApp" --out /tmp/ios.png

# Staging desktop
node scripts/proxy-browser.cjs https://staging.blackouttrades.com --viewport 1440x900 --out /tmp/staging.png
```
