## 2026-10-08 — [FINDING, discovery] `scripts/ios-shared/codemagic-signing.sh`'s header comment claimed a shared-between-both-apps wiring that was never actually done — comment corrected; the real fork-drift gap is written up, not fixed — FIXED (comment-only; underlying gap flagged for a decision)

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | iOS CI (Codemagic / GitHub Actions signing scripts) |
| **Status** | FIXED (comment-only correction in this PR); underlying script-fork gap below is NOT fixed — flagged for a decision |

**What was wrong:** `scripts/ios-shared/codemagic-signing.sh`'s header comment stated it is
"Shared between the Capacitor WebView shell (apps/blackout-ios) and the native SwiftUI app
(apps/blackout-ios-native)" and that "the caller sets PBX_PATH to the correct path; env-var
defaulting keeps the existing WebView TestFlight workflow working without changes." This is false
today: the WebView pipeline (`codemagic.yaml`, `working_directory: apps/blackout-ios`) runs
`bash scripts/codemagic-signing.sh`, which resolves to the SEPARATE file
`apps/blackout-ios/scripts/codemagic-signing.sh` — not the "shared" one. The only real caller of
`scripts/ios-shared/codemagic-signing.sh` is the native app's own GitHub Actions workflow
(`.github/workflows/blackout-ios-native-testflight.yml:156`,
`bash ../../scripts/ios-shared/codemagic-signing.sh`).

**Evidence:**
- `grep -n "codemagic-signing\|working_directory" codemagic.yaml` → line 9
  `working_directory: apps/blackout-ios`, line 40 `script: bash scripts/codemagic-signing.sh`
  (relative to that working_directory → `apps/blackout-ios/scripts/codemagic-signing.sh`).
- `grep -rln "codemagic-signing" --include="*.yml" --include="*.yaml" .` → only
  `codemagic.yaml` and `.github/workflows/blackout-ios-native-testflight.yml`; the latter is the
  only caller of the `ios-shared/` copy.
- `diff apps/blackout-ios/scripts/codemagic-signing.sh scripts/ios-shared/codemagic-signing.sh`
  shows the two have diverged substantially. The WebView's actual script (last touched 3 months
  ago, PR #551) lacks two fixes present only in the unused-by-WebView "shared" copy: the
  Apple-cert-limit stranded-cert sweep (dated 2026-07-27 in-file) and the quoted-vs-unquoted
  `PRODUCT_BUNDLE_IDENTIFIER` regex fix (PR #1141, 2 months ago, needed because XcodeGen quotes the
  value and Capacitor does not — ironically a fix the WebView's own Capacitor-generated pbxproj
  could in principle need too, depending on Xcode/Capacitor version).

**Fix in this PR:** Corrected the header comment to describe the actual wiring — the file is
*written to be* shareable (same bundle id/team, `PBX_PATH` lets a caller point it at either app's
Xcode project) but only the native workflow currently calls it; the WebView pipeline still runs its
own older, diverged copy. No behavior change — comment-only.

**What is NOT fixed, and why:** Actually pointing `codemagic.yaml` at the shared script (so the
WebView pipeline picks up the cert-sweep and regex fixes too) is a CI/build-pipeline change for a
live App Store signing path that cannot be validated from this sandbox (no Codemagic/Apple
credentials, no way to dry-run a TestFlight signing step) and is deploy-risky if wrong (a broken
signing step blocks every WebView TestFlight build). This belongs to whoever owns the iOS build
pipeline to evaluate and test — not something to change unilaterally on a doc-fix pass. Flagging
here so the gap doesn't go unnoticed: either migrate `codemagic.yaml` to call
`scripts/ios-shared/codemagic-signing.sh` with the Capacitor `PBX_PATH`, or deliberately fork the
two cert-limit/regex fixes back into `apps/blackout-ios/scripts/codemagic-signing.sh` — either
closes the drift; leaving it as-is is also a legitimate choice if the WebView app is being sunset,
which this audit has no visibility into.
