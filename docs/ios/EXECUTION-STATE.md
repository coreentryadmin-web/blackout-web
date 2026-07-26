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

## Done (2026-07-26)
- Verified ASC key + live app state; premium icon + splash from brand emblem; `@capacitor/assets` wired.
- Completed GitHub Actions build/ship pipeline.
- Built iOS UI audit harness + baseline render.
- 4-part audit (CI / metadata / 3.1.1 / native-value) → `docs/ios/*AUDIT*.md`.
- **P0-4** done: removed `*.whop.com` from WKWebView `allowNavigation`.
- **P0-2** done (code): gated homepage pricing table + "See pricing" for iOS; neutral membership note added. *Needs deploy + iPhone-render validation.*

## NEXT HIGHEST-PRIORITY TASK
1. **Get P0-2 + P0-4 to prod and validate** — ensure CI (verify + CodeQL) green on the branch, merge
   to `main`, let prod deploy, then run:
   `env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY node scripts/ios/ios-ui-audit.mjs --base https://blackouttrades.com --pages "/"`
   and confirm the iOS render shows the neutral note + **no** pricing/amounts/"See pricing".
2. **P0-1 `/privacy` page** — build the Privacy Policy route (Apple hard requirement); content per
   `docs/ios/NATIVE-VALUE-AND-PRIVACY-AUDIT.md` data inventory. Additive, validatable now.
3. **P0-3 server-side iOS detection** — read `BlackOutiOSApp` UA server-side so pricing/purchase
   markup never ships to the app (hardens P0-2 from CSS-hide to not-rendered).
4. Then **N-1 Face ID** / **N-2 APNs** (native code — write now, validate once a Mac is available),
   **N-4 head-script fix** (validatable now), then **U-*** per-page premium polish.

## Requested-docs status (master prompt)
`EXECUTION-STATE.md` (this) live. Others — PRODUCT-VISION, INFORMATION-ARCHITECTURE, DESIGN-SYSTEM,
TECHNICAL-ARCHITECTURE, API-CONTRACTS, SECURITY-REVIEW, APP-STORE-READINESS, QA-MATRIX, KNOWN-RISKS,
RELEASE-CHECKLIST — created as their phase is reached (audits already captured in `docs/ios/*AUDIT*.md`).
