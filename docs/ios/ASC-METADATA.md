# App Store Connect Metadata Package — BlackOut iOS 1.0

Grounded in the live product (`src/lib/marketing/products.ts`, `src/lib/faq/content.ts`, `src/lib/site.ts`, `apps/blackout-ios/capacitor.config.ts`). Char counts shown for every length-limited field. Nothing below contains pricing, purchase links, or any mention of Discord/Whop/external checkout, per guideline 3.1.1.

> **One hard blocker flagged up front:** the app currently has **no Privacy Policy page** (`/privacy`, `/terms`, `/support` do **not** exist as routes — verified; only `/faq`, `/learn`, `/pricing`, `/upgrade` exist under `(marketing)`). Apple **requires a working Privacy Policy URL** to submit. A `/privacy` page must be published before submission. Everything else here is submit-ready.

---

## App Name (max 30)

| | Name | Chars |
|---|---|---|
| **Recommended** | `BlackOut` | **8** |
| Alt A | `BlackOut Trades` | **15** |
| Alt B | `BlackOut: Options Flow` | **22** |

**Recommendation:** ship **`BlackOut`** — it matches the Capacitor `appName` ("BlackOut"), the brand emblem, and the in-app chrome, so the icon label and store name agree. Set this to replace the current placeholder ASC name `com.blackout-trades.app`.

**Caveat / hedge:** a one-word name is more likely to draw a "generic / not distinctive" metadata query from review and is weaker for search. If you want insurance on both fronts, use **`BlackOut Trades`** (15) — it matches `SITE.name` and the domain, is unmistakably branded, and still reads clean on the home screen (iOS truncates the icon label to ~12 chars either way). Alt B adds a search descriptor if you want keywords in the visible name.

---

## Subtitle (max 30) — 3 options

| | Subtitle | Chars |
|---|---|---|
| Option 1 (recommended) | `Live options flow & GEX` | **23** |
| Option 2 | `Dealer gamma, flow & 0DTE` | **25** |
| Option 3 | `Options flow & gamma desk` | **25** |

Option 1 leads with the two highest-intent search terms (options flow, GEX) and stays well inside the limit. All three avoid brand-infringing terms.

---

## Promotional Text (max 170)

```
Dealer gamma, live options flow, 0DTE structure, and graded swing setups — the intelligence layer pro desks pay for, in one command surface.
```
**Chars: 142.** (Editable anytime without a new binary — good place to rotate seasonal/timely copy.)

---

## Description (max 4000)

**Chars: 2,535.**

```
BlackOut is the institutional options desk, rebuilt for iPhone. Dealer positioning, live options flow, and 0DTE market structure — the intelligence layer professional desks pay a premium for, unified in one command surface.

SIX DESKS, ONE SURFACE

SPX Slayer — the 0DTE command desk. A live SPX gamma matrix, dealer walls, king strikes, and a graded (A–F) play read with entry, target, stop, and the invalidation level.

HELIX — the institutional flow tape. Tick-by-tick unusual options activity with sweep-vs-block detection, premium filters, and anomaly scoring.

BlackOut Thermal — the dealer gamma heatmap. GEX, VEX, DEX, and CHARM mapped across strikes and expiries, so you can see where dealers are pinned.

Largo — the desk analyst. Ask about flow, gamma, or regime in plain English and get a structure-first read grounded in the same live data as your tools.

Night Hawk — the swing playbook. An evening scanner plus a transparent A–F play log with the full thesis behind every setup.

Vector — the gamma-wall radar. Cross-ticker flow and gamma structure that shows support, resistance, and the flip level as they form.

WHY TRADERS USE BLACKOUT

- Real-time, tick-by-tick data — no 15-minute delays
- Professional-grade options and equity feeds in one clean layer
- Dealer gamma, dark-pool context, and market internals side by side
- A transparent, append-only performance log — judge the read on its own results
- Real-time in-app alerts the moment structure shifts

PURE INTELLIGENCE — YOU TRADE YOUR WAY

BlackOut is a market-intelligence and analytics platform, not a broker. There is no account to fund, no order routing, and no trades are ever placed in the app. We surface the structure; you execute wherever you already trade.

INFORMATIONAL & EDUCATIONAL ONLY

BlackOut provides market data, analytics, and pattern-recognition tools for informational and educational purposes only. Nothing in the app is financial, investment, or trading advice, or a recommendation to buy or sell any security. BlackOut is not a broker-dealer or investment adviser and executes no trades. Options trading involves substantial risk and is not suitable for every investor. Past performance is not a guarantee of future results. Every trading decision is your own.

MEMBERSHIP

BlackOut requires an active membership. Membership is created and managed on our website; the app itself is sign-in only. Sign in with your existing account to open the desk.

Questions? Reach the desk at support@blackouttrades.com.
```

*Compliance note on the MEMBERSHIP paragraph:* it states — factually and with no link, price, button, or CTA — that membership is managed on the web and the app is sign-in only. This is the canonical "reader app" (Netflix/Spotify) wording Apple permits. Do **not** add a URL, price, or "subscribe" action to this paragraph or you cross 3.1.1 / 3.1.3.

---

## Keywords (max 100, incl. commas, no spaces after commas)

```
options,flow,gamma,gex,0dte,spx,dealer,dark,pool,unusual,sweeps,scanner,greeks,charm,heatmap,vex
```
**Chars: 96.** Notes:
- No spaces (maximizes token count); Apple auto-combines singles, so `dark`+`pool` → "dark pool", `options`+`flow` → "options flow", etc.
- No brand-infringing terms (no competitor/data-vendor/broker names, no "TradingView/Bloomberg/Robinhood/Unusual Whales", no Discord/Whop).
- App-name words ("blackout", "trades") deliberately excluded — they're already indexed from the name field, so repeating them wastes budget.
- `spx`/`gex`/`0dte`/`vex` are generic market terms, safe to use.

---

## URLs

| Field | Value | Status |
|---|---|---|
| **Marketing URL** (optional) | `https://blackouttrades.com` | ✅ live |
| **Support URL** (required) | `https://blackouttrades.com/faq` | ✅ live — `/faq` renders public and contains the "How do I reach the team" contact + `support@blackouttrades.com` |
| **Privacy Policy URL** (required) | `https://blackouttrades.com/privacy` | ⚠️ **DOES NOT EXIST YET — must be published before submission** |

- **Support URL:** `/faq` is an acceptable support destination (it lists `support@blackouttrades.com`). If you want a cleaner reviewer experience, publish a small `/support` or `/contact` page with the support email + response expectations, but `/faq` will pass as-is.
- **Privacy Policy URL:** hard requirement. `/privacy` returns nothing today. Publish a policy that covers exactly what's collected (Clerk email/phone, Sentry diagnostics, APNs push token, subscription status) and it must be reachable without auth. **This is the single item that will block submission if unresolved.**

---

## Categories

- **Primary: Finance**
- **Secondary: Business**

**Reasoning:** the app's entire value is financial-market data and analytics — options flow, dealer gamma/GEX, 0DTE structure, market internals. **Finance** is the unambiguous primary; it's where traders browse and where the keyword intent lives. **Business** is the correct secondary: BlackOut is a professional/pro-user analytics tool (a "desk"), and Business is the standard secondary for pro data/terminal apps, giving a second discovery surface without over-reaching. Avoid "Productivity" (weaker fit) and do **not** pick a category that implies brokerage. Being in Finance does *not* force any brokerage/IAP requirement — the app executes no trades and sells nothing in-app; the reviewer notes below make that explicit.

---

## Age Rating Questionnaire

Recommended answers (classic ASC content-descriptor form, which is what governs the web-access question the task asks about):

| Question | Answer |
|---|---|
| Cartoon or Fantasy Violence | **None** |
| Realistic Violence | **None** |
| Prolonged Graphic or Sadistic Realistic Violence | **None** |
| Profanity or Crude Humor | **None** |
| Mature/Suggestive Themes | **None** |
| Horror/Fear Themes | **None** |
| Medical/Treatment Information | **None** |
| Alcohol, Tobacco, or Drug Use or References | **None** |
| Sexual Content or Nudity | **None** |
| Graphic Sexual Content and Nudity | **None** |
| Simulated Gambling | **None** |
| Contests | **None** |
| Gambling (real money) | **No** |
| **Unrestricted Web Access** | **No** |
| Made for Kids | **No** |

**Resulting rating: 4+.**

**Unrestricted Web Access — the key call, answer NO.** "Unrestricted web access" means the app can browse the open internet like a general-purpose browser. BlackOut's WKWebView cannot: `apps/blackout-ios/capacitor.config.ts` pins `server.url` to `https://blackouttrades.com` and constrains `allowNavigation` to a fixed allow-list — `blackouttrades.com`, `*.blackouttrades.com`, `clerk.blackouttrades.com`, `*.clerk.accounts.dev`, `challenges.cloudflare.com`, `*.tradingview.com`, `*.whop.com`. That's our own domain plus the auth / Turnstile / charting / billing infra the site itself needs — **not** arbitrary browsing. So the honest answer is **No**, and the rating stays **4+**.
- If this were answered **Yes**, Apple auto-forces the rating to **17+**. There is no reason to accept that here.
- **Standing constraint:** keep the `allowNavigation` allow-list closed. If anyone later adds a general in-app browser or an open external-link handler, the honest answer flips to Yes and the rating jumps to 17+. Note this in the iOS shell's code comments.

**One watch-item (does not change 4+):** Largo is an AI analyst. It is **not** user-to-user content (no UGC/social surface), and it's domain-constrained to market-structure answers, so it does not trigger UGC-moderation or mature-content rules. Under Apple's newer (2025) unified questionnaire the app still lands at **4+** — but confirm Largo's guardrails keep it from emitting mature/unrelated content. Mark **VERIFY: Largo output moderation posture**.

---

## App Privacy ("Nutrition Label")

The app **does** collect data (Clerk auth needs email + phone), so **"Data Not Collected" is NOT valid.** No third-party ad/tracking SDKs were found (no PostHog/GA/Segment/Amplitude/Mixpanel; only Clerk, Whop SDK, and Sentry). No `NSUserTrackingUsageDescription` / ATT prompt is present — so **"Used to Track You" = No for every item.**

| Data Type | Example / source | Linked to identity? | Used to track? | Purpose | Notes |
|---|---|---|---|---|---|
| **Contact Info — Email address** | Clerk sign-in | **Linked** | No | App Functionality (authentication, account) | Core to login. |
| **Contact Info — Phone number** | Clerk requires a phone on user creation | **Linked** | No | App Functionality (account security) | Confirmed in CLAUDE.md ("Clerk instance requires a phone number"). |
| **Contact Info — Name** | Clerk profile (if set) | **Linked** | No | App Functionality | **VERIFY** whether name is actually captured/stored. |
| **Identifiers — User ID** | Clerk user id | **Linked** | No | App Functionality | Session/account identity. |
| **Identifiers — Device ID (push token)** | APNs token via `@capacitor/push-notifications` | **Linked** | No | App Functionality (deliver alerts) | Only if a user enables push. **VERIFY** token is stored server-side and mapped to the user. |
| **Purchases — Purchase history / subscription status** | Membership tier read from Whop | **Linked** | No | App Functionality (gate desk access) | Purchase happens on web; app only *reads* tier. **VERIFY** whether the tier read counts as "collected by the app" for your declaration. |
| **Diagnostics — Crash data** | Sentry (`@sentry/nextjs`) | **VERIFY** (likely Not Linked) | No | App Functionality / Analytics | **VERIFY** Sentry is actually initialized in the iOS/web build and whether user id is attached (if attached → Linked). |
| **Diagnostics — Performance data** | Sentry | **VERIFY** (likely Not Linked) | No | Analytics | Same VERIFY as above. |

**Items to VERIFY before you finalize the label (do not guess on the form):**
1. Sentry: is it live in the served build, and is any user identifier attached to events? (Determines Diagnostics linkage.)
2. Push token: is it persisted and associated with the user? (Determines the Device ID row.)
3. Whether Clerk **Name** is collected.
4. Whether the Whop **subscription-status** read must be declared as "Purchases."
5. Confirm there is genuinely **no** analytics SDK in the iOS build beyond Sentry (search found none — reconfirm at build time).

**Not collected (confirm):** Financial Info (no bank/card in-app — payment is on web), Location, Health, Contacts, Photos, Browsing History, Audio, Search history.

---

## App Review Information → Notes (reviewer notes)

```
BUSINESS MODEL — sign-in only (reader app, à la Netflix / Spotify)

BlackOut is a market-data and analytics app for options traders. It does NOT
sell anything inside the app and contains NO in-app purchases. Membership is
purchased and managed entirely on our website; the iOS app is sign-in only.
Per guideline 3.1.1, all pricing and purchase UI is intentionally hidden inside
the app — the web app detects the iOS WebView (user-agent token "BlackOutiOSApp")
and suppresses every price, plan, and checkout element. This is by design, not a
missing feature. There is no external-purchase link or CTA anywhere in the app.

NOT A BROKERAGE / NO TRADING

The app is informational and educational only. It executes no trades, routes no
orders, connects to no brokerage, and holds no funds. It displays market data,
options-flow analytics, and dealer-gamma (GEX) structure. Users act on their own
broker, outside the app.

SIGN-IN METHOD

Sign-in uses email one-time-code (OTP). Social/Google sign-in is intentionally
hidden in the iOS app because OAuth is not supported inside WKWebView. Please use
the demo credentials below.

DEMO ACCOUNT

Username (email): [demo email]
Password: [demo password]
The demo account is a full-access member, so every desk is unlocked.
[If a one-time email code is requested instead of a password, see the note in the
Demo Account section — the account is configured so review can sign in without
access to our email inbox.]

STEP-BY-STEP WALKTHROUGH

1. Launch BlackOut. The app opens to the marketing/sign-in surface (no pricing is
   shown — this is intentional, see above).
2. Tap Sign in. Enter the demo email and password provided above and submit.
3. You'll land on the desk. Open each module from the tab bar / nav:
   - SPX Slayer (0DTE gamma matrix + graded play read)
   - HELIX (live options-flow tape)
   - BlackOut Thermal (dealer gamma heatmap)
   - Largo (ask the AI desk analyst a question in plain English)
   - Night Hawk (evening swing playbook / A–F log)
   - Vector (gamma-wall radar)
4. All data is live market data for informational/educational use. No trade is
   ever placed and no purchase is offered anywhere in the app.

Contact for review questions: support@blackouttrades.com
```

Replace `[demo email]`/`[demo password]` with the provisioned values before submitting. Also delete the stray **MAC_OS 1.0** version in ASC so review only sees the iOS submission (housekeeping, not metadata).

---

## Demo Account Plan

**Provision:** one Clerk user, created via the Backend API, with:
- `publicMetadata.role = "admin"` — bypasses every per-tool launch gate (per the auth model in CLAUDE.md, `role:admin` bypasses gates), so nothing is locked during review.
- `publicMetadata.tier = "premium"` — full desk access even if the admin bypass is ever scoped down.
- A real phone number on creation (Clerk requires it — use `generateDefaultAuditPhone()` style E.164, e.g. `+1415555xxxx`).
- A stable, long-lived email you control, e.g. `appreview@blackouttrades.com`.

Put that email in **Demo Account — Username** and set **Sign-In Required = Yes**.

**The OTP problem (call it out to yourself, then solve it):** the iOS sign-in is **email OTP**, and Apple's reviewer cannot receive a code sent to *your* inbox. A username with no usable second factor = an automatic "we could not sign in" rejection. Pick one of these, in order of preference:

1. **Enable a password credential on the demo user (recommended).** Set a password on the demo Clerk user and confirm the in-app sign-in screen exposes email + password (Clerk password strategy) inside the WebView. Then fill **Demo Account — Password** with it and the reviewer signs in with no code. → **VERIFY** the WebView sign-in actually offers the password path (social is hidden; confirm password is not also hidden). This is the cleanest and is what the ASC Password field is designed for.

2. **If password can't be surfaced in-app:** provision the demo email on a mailbox the team monitors and, in Review Notes, state that review can request the current code from `support@blackouttrades.com` (real people, fast replies) — plus, if feasible, give the demo user a **fixed/static verification code** or a Clerk review-bypass so the code is deterministic. Document the exact retrieval step in the Notes.

3. **Do not** rely on the reviewer having access to a live inbox — that's the failure mode to avoid.

**Whichever path:** the account must stay active through the entire review window (do **not** run it through the temp-user auto-delete cleanup that the audit scripts use), and it should be marked internally so it isn't purged by `clerk:purge-test-users`.

---

### Pre-submission checklist (blockers first)
1. **Publish `/privacy`** (Privacy Policy URL) — hard blocker, currently missing.
2. Set app **Name = BlackOut** (replaces placeholder `com.blackout-trades.app`).
3. Provision the **demo account** and verify the password (or OTP-bypass) sign-in path in the WebView.
4. Complete the **App Privacy** label; resolve the 5 VERIFY items above.
5. Confirm **Unrestricted Web Access = No** and the `allowNavigation` allow-list is still closed.
6. Delete the stray **MAC_OS** version; attach the one valid iOS build (v1, uploaded 2026-07-05).

Source references: desks/value props — `src/lib/marketing/products.ts`, `src/lib/faq/content.ts`; disclaimer wording already shipped in-product — `src/components/OnboardingGuide.tsx:154`, `src/components/upgrade/UpgradePageShell.tsx:94`, `src/lib/faq/content.ts:66`; iOS model + allow-list — `apps/blackout-ios/capacitor.config.ts`; support email — `src/lib/faq/content.ts:1`; routes that exist — `src/app/(marketing)/{faq,learn,pricing,upgrade}`, `src/app/(site)/*` (no `/privacy`, `/terms`, `/support`).
