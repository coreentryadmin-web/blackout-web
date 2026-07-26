# iOS app assets (icon + splash source masters)

`@capacitor/assets` generates every native icon/splash size from these masters at build time
(`npm run assets:generate`, wired into `codemagic.yaml` and the GitHub Actions build). Do not
hand-edit the generated `ios/App/App/Assets.xcassets` — regenerate from here.

| File | Size | Notes |
|---|---|---|
| `icon.png` | 1024×1024 | App Store icon. **Opaque, no alpha** (Apple rejects alpha). Derived from `public/images/blackout-emblem.webp` (the brand emblem). |
| `splash.png` | 2732×2732 | Launch screen, emblem centered on the `#040407` void. |
| `splash-dark.png` | 2732×2732 | Dark-mode launch screen (same). |

To regenerate the masters from the brand emblem, re-run the Pillow step documented in
`docs/ios/IOS-PREMIUM-PROGRAM.md` (source: `public/images/blackout-emblem.webp`).
