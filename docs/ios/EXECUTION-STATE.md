# iOS Execution State — resume pointer

**Read this first every session, then continue.** Full backlog + architecture live in
`docs/ios/IOS-PREMIUM-PROGRAM.md`. This file is the "where am I / what's next" pointer.

## Hard environment constraint + the build strategy (RESOLVED 2026-07-26)
This is a **Linux** sandbox — no local Mac/Xcode. Native iOS is *written* here and *compiled/tested*
remotely. The strategy:
1. **PRIMARY dev/test loop → GitHub Actions macOS runners.** Confirmed working via the GitHub MCP
   channel (list/trigger workflows + read job logs + artifacts). Compiling Swift, running XCTest, and
   snapshot/UI tests need **no AWS quota and no secrets** — I push code + a macOS CI workflow, trigger
   it, and read results + snapshot PNGs as artifacts. This is the autonomous native build/test loop.
2. **ACCELERATOR → AWS EC2 Mac.** Owner provided AWS creds (account 177922194517, profile
   `blackout-mac`, session-local, never committed). All Mac host quotas were **0**; a quota increase
   for `Running Dedicated mac2 Hosts` (L-5D8DADF5 → 1) is **PENDING AWS review** (req
   `89b92573…`, 2026-07-26). When granted → interactive Xcode over SSH + local signing.
3. **RELEASE signing/upload** → either the AWS Mac (sign with the ASC key already held) or the 3
   GitHub secrets. Only needed at submission time, not during build-out.
Web-side iOS-shell work remains fully doable + validatable now via `scripts/ios/ios-ui-audit.mjs`
(the hybrid is the transitional bridge; native is the target per the master prompt).

## Architecture decision (current)
Ship the **premium hybrid** (Capacitor WKWebView + rich native shell) to App-Store-ready FAST — it's
the only path fully buildable *and* validatable from here today. Evolve toward native SwiftUI
module-by-module **once a Mac is available** (unlock #1). The master-prompt native vision
(`docs/ios/PRODUCT-VISION.md` etc.) is the north star; sequencing is hybrid-first for a shippable v1,
native-forward for v2. Revisit if the owner directs otherwise.

## Done
**2026-07-26** — ASC key verified; premium icon+splash from brand emblem; `@capacitor/assets` wired.
GitHub Actions build/ship pipeline complete. iOS UI audit harness + baseline render. 4-part audit
docs. **P0-4** (removed `*.whop.com` from `allowNavigation`) + **P0-2** (homepage pricing hidden
in-app + neutral membership note).

**2026-07-27** — Foundation docs (2,344 lines): PRODUCT-VISION, INFORMATION-ARCHITECTURE,
TECHNICAL-ARCHITECTURE, API-CONTRACTS, DESIGN-SYSTEM. **P0-1** (`/privacy` page) — real Privacy
Policy grounded in actual data inventory; public/unauthenticated; matches marketing style;
EFFECTIVE_DATE constant. Verified AWS creds work (acct 177922194517, profile `blackout-mac`);
Mac host quota = 0 → increase requested (mac2, L-5D8DADF5→1, req `89b92573…`, pending AWS review).
Verified GitHub Actions macOS runners are the primary native dev/test loop (no quota/secrets).

**2026-07-27 (cont.)** — **P0-3** server-side iOS UA gate: `isIosAppShellFromHeaders()`,
`RedesignHome` server-conditionally renders pricing OR the neutral note (both `hide-in-ios-app`
/ `show-in-ios-app` classes stay as belt-and-braces); CF cache rule `f261edb0` patched via API
to also bypass on `BlackOutiOSApp` UA (mirrors `__session` bypass) — iOS UA → cf-cache-status
MISS live-verified. **N-4** head-script pending-shell regex adds `/vector`, drops dead `/grid`,
pinned with regression test in `ios-tool-routes.test.ts`. All 4 P0 submission blockers now DONE.

## NEXT HIGHEST-PRIORITY TASK
1. **After PR #1106 CI green + merge + prod deploy**, run the audit to prove the P0 set is live:
   `env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY node scripts/ios/ios-ui-audit.mjs --base https://blackouttrades.com --pages "/,/privacy"`
   Expected: `/` iOS render shows the neutral note + **no** pricing DOM (grep the served HTML
   with `?ua=iOS` for `$75|$199|1,999|Start now|See pricing` — must be zero hits); `/privacy`
   returns 200 with the policy content.
2. **Native scaffold on GitHub macOS CI** — create `apps/blackout-ios-native/` Xcode/SwiftUI
   project scaffold + `.github/workflows/blackout-ios-native-ci.yml` (build + XCTest snapshot
   tests on `macos-14`, artifact upload). Unlocks the native build/test loop from this box —
   no AWS Mac needed.
3. **N-1 Face ID** (LocalAuthentication + Keychain + app-resume gate + Account toggle).
4. **N-2 real APNs** (`@capacitor/push-notifications` register → native token table row →
   server APNs sender using the ASC key; hide the inert web-push toggle in-app). Then N-3
   (StatusBar calls + `@capacitor/app` `appUrlOpen` deep links + native share).
5. **U-*** per-page premium polish (validate each on the iPhone render).
6. **M-*** ASC listing metadata + demo account + screenshots — ask before mutating live.

## Requested-docs status (master prompt)
`EXECUTION-STATE.md` (this) live. Others — PRODUCT-VISION, INFORMATION-ARCHITECTURE, DESIGN-SYSTEM,
TECHNICAL-ARCHITECTURE, API-CONTRACTS, SECURITY-REVIEW, APP-STORE-READINESS, QA-MATRIX, KNOWN-RISKS,
RELEASE-CHECKLIST — created as their phase is reached (audits already captured in `docs/ios/*AUDIT*.md`).
