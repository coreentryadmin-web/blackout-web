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

## NEXT HIGHEST-PRIORITY TASK
1. **P0-3 server-side iOS UA detection** — read `BlackOutiOSApp` UA in middleware/root layout so
   pricing/purchase markup never ships to the app (hardens P0-2 from CSS-hide to not-rendered).
2. **N-4 head-script fix** — pending-shell regex in `src/app/layout.tsx:80-98` omits `/vector` and
   includes dead `/grid` → `/vector` flashes web Nav in-app. Small fix.
3. Once merged/deployed, re-run `scripts/ios/ios-ui-audit.mjs` against prod to confirm the iOS
   render shows the neutral note + **no** pricing/amounts/"See pricing", and `/privacy` renders.
4. **Native scaffold on GitHub macOS CI** — create `apps/blackout-ios-native/` Xcode/SwiftUI
   project + a `.github/workflows/blackout-ios-native-ci.yml` (build + snapshot tests on
   `macos-14`); this unlocks the native build/test loop this session.
5. **N-1 Face ID** / **N-2 APNs native register + server sender**. Write now; validates on the
   macOS CI (or the AWS Mac if quota clears).
6. Then **U-*** per-page premium polish (validate each on the iPhone render).

## Requested-docs status (master prompt)
`EXECUTION-STATE.md` (this) live. Others — PRODUCT-VISION, INFORMATION-ARCHITECTURE, DESIGN-SYSTEM,
TECHNICAL-ARCHITECTURE, API-CONTRACTS, SECURITY-REVIEW, APP-STORE-READINESS, QA-MATRIX, KNOWN-RISKS,
RELEASE-CHECKLIST — created as their phase is reached (audits already captured in `docs/ios/*AUDIT*.md`).
