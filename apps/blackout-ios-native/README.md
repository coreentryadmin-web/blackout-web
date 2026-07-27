# BlackOut iOS — Native SwiftUI

The native BLACKOUT iOS application, per the master prompt and the design
+ architecture docs under `docs/ios/`. This is distinct from
`apps/blackout-ios` (the transitional Capacitor WebView shell). The two
coexist while native modules are migrated one by one; the WebView shell is
retired when the migration plan in `docs/ios/TECHNICAL-ARCHITECTURE.md`
completes.

## Layout

```
apps/blackout-ios-native/
├── project.yml                     # XcodeGen spec — source of truth for the Xcode project
├── BlackOut/
│   ├── BlackOutApp.swift           # @main SwiftUI App
│   ├── RootView.swift              # 5-tab IA (Command / Intelligence / Signals / Watchlist / Account)
│   ├── DesignSystem/
│   │   ├── Colors.swift            # semantic + palette tokens (grounded in DESIGN-SYSTEM.md)
│   │   ├── Typography.swift        # SF Pro Display/Text + SF Mono, Dynamic-Type-first
│   │   ├── Spacing.swift           # 4pt scale + radii + touch target
│   │   └── Motion.swift            # semantic animation tokens
│   ├── Features/
│   │   ├── Command/                # tab 1 (default market command center)
│   │   ├── Intelligence/           # tab 2 (SPX Slayer / Helix / Thermal / Largo / Night Hawk / Vector)
│   │   ├── Signals/                # tab 3 (setup lifecycle)
│   │   ├── Watchlist/              # tab 4 (personalized tickers + alerts)
│   │   └── Account/                # tab 5 (subscription / security / notifications / support)
│   ├── Common/
│   │   ├── PlaceholderView.swift   # design-system-conformant scaffold used by unbuilt tabs
│   │   └── BiometricGate.swift     # Face ID / Touch ID service (LocalAuthentication + Keychain-adjacent)
│   └── Resources/Assets.xcassets/  # AppIcon (from public/images/blackout-emblem.webp), AccentColor, LaunchBackground
└── BlackOutTests/
    ├── DesignSystemTests.swift     # token contract tests
    ├── RootViewTests.swift         # 5-tab IA contract tests
    └── BiometricGateTests.swift    # LAContext-mocked biometric flow tests
```

## Build strategy — no local Mac required

The Xcode project is **not committed**. It's generated on every build from
`project.yml` by [XcodeGen](https://github.com/yonaskolb/XcodeGen).

- **CI (primary):** `.github/workflows/blackout-ios-native-ci.yml` runs on
  `macos-14` runners on every PR touching this dir; `xcodebuild build`,
  `xcodebuild test` (with code-signing disabled), and uploads the
  `.xcresult` bundle as an artifact. No secrets, no quota. This is the loop
  for making native changes from a Linux development environment.
- **Local (if you have a Mac):**
  ```bash
  brew install xcodegen
  cd apps/blackout-ios-native
  xcodegen generate
  open BlackOut.xcodeproj
  ```
- **AWS EC2 Mac (once the quota clears):** provides an interactive session
  for iteration + local signing; same commands as the local-Mac path.

Signing / TestFlight upload for the native app will be wired through the
existing `blackout-ios-testflight.yml` pipeline (same ASC API key)
after the native app matures beyond scaffold.

## What's shipped in the scaffold

- **Design system in Swift** — color / typography / spacing / motion tokens
  mirror the CSS tokens on the web (`src/app/ios-native-tokens.css`,
  `ios-native-skin.css`) so identity travels across surfaces. Contract-tested.
- **5-tab IA** — the native information architecture from
  `docs/ios/INFORMATION-ARCHITECTURE.md`, with each tab wired to a
  `PlaceholderView` scaffold that names exactly what's coming (nothing
  disguised as done). Contract-tested.
- **Face ID service** — `BiometricGate` wraps `LocalAuthentication` behind
  a protocol seam so every failure mode is a typed case (`.userCancelled`,
  `.biometryLockout`, `.notAvailable`, …). UI wiring lands with the
  Account settings screen next.
- **App icon + accent + launch background** — the same brand emblem shipped
  to the Capacitor app (`public/images/blackout-emblem.webp` → 1024²
  opaque PNG). AccentColor = BLACKOUT bull green (#00E676).
- **Info.plist essentials** — Face ID usage description, dark-only UI,
  portrait-only, ATS locked to `blackouttrades.com` (no arbitrary loads),
  finance category, remote-notification background mode.
- **Snapshot-quality unit test suite** — design-system contract, IA
  contract, biometric flow with a `FakeEvaluator` so every LA error path
  is covered without touching the real system prompt.

## What's coming next (in order)

1. Command tab first — real content, not a placeholder. Fetches session
   header + market regime from the API surface catalogued in
   `docs/ios/API-CONTRACTS.md`.
2. Native APNs registration + backend token table + server sender using the
   ASC key.
3. Face ID Settings toggle + app-resume gate wiring the `BiometricGate`
   service into the app lifecycle.
4. Sign in with Apple + Clerk-native session bridging (per
   TECHNICAL-ARCHITECTURE.md's auth section).
5. Intelligence tab modules (SPX Slayer first), replacing WebView surfaces
   one at a time per the migration plan.
