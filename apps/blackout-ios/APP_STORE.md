# BlackOut iOS — App Store Connect (filled)

**Canonical location:** `apps/blackout-ios/` inside **`coreentryadmin-web/blackout-web`** — one repo only.

| Field | Value |
|-------|--------|
| **Legal entity** | BLACKOUT TRADE LLC |
| **Team ID** | `ZA32C782N5` |
| **Bundle ID** | `com.blackout-trades.app` (Apple ASC / signing) |
| **App Store Connect Apple ID** | `6787797476` |
| **SKU** | `blackout-ios-2020` |
| **WKWebView UA token** | `BlackOutiOSApp` (must match `src/app/layout.tsx`) |

## Codemagic (recommended — no Mac)

1. [codemagic.io](https://codemagic.io) → add GitHub app **`coreentryadmin-web/blackout-web`**
2. Root **`codemagic.yaml`** auto-detected (`working_directory: apps/blackout-ios`)
3. Integration **BlackOut ASC** (App Store Connect API `.p8`)
4. Run workflow **ios-release** → TestFlight (~15 min)

### Environment variables (app settings)

**Leave this empty.** `codemagic.yaml` already sets `APPLE_TEAM_ID`, `BUNDLE_ID`, etc. Adding vars here overrides YAML and can break signing.

### Signing failures (checklist)

| Symptom | Fix |
|---------|-----|
| Team `663D77E68E` or other ID (not `ZA32C782N5`) | **Team integration**, not app env vars. Codemagic → **Teams** → your team → **Team integrations** → **Developer Portal** → **BlackOut ASC** must use the API key from **BLACKOUT TRADE LLC** (Issuer ID from [App Store Connect → Users and Access → Keys](https://appstoreconnect.apple.com/access/integrations/api)). |
| Bundle typo in logs | Repo uses **`com.blackout-trades.app`**. If logs show `blackout-trader`, rebuild from latest **`main`** (includes Xcode bundle patch). |
| No IOS_DISTRIBUTION certificate | API key **BlackOut ASC** must be **App Manager** (not Developer). In ASC, key name is usually `Codemagic BlackOut`, key ID `45YGMDL3JS`. |
| Manual cert (optional) | Codemagic → Team settings → **Code signing identities** → Generate **Apple Distribution** with **BlackOut ASC** key. |

From repo root: `npm run validate:ios-config`

## GitHub Actions (alternative)

Repo → Settings → Secrets → Actions:

| Secret | Value |
|--------|--------|
| `APPLE_TEAM_ID` | `ZA32C782N5` |
| `APP_STORE_CONNECT_ISSUER_ID` | from ASC API page |
| `APP_STORE_CONNECT_KEY_ID` | from ASC API page |
| `APP_STORE_CONNECT_PRIVATE_KEY` | contents of `.p8` file |

Then: Actions → **BlackOut iOS TestFlight** → Run workflow.

## App Store Connect — still to complete (browser)

- [ ] **Content Rights** → Set Up
- [ ] **Category** → Primary: Finance
- [ ] **Age Rating** questionnaire
- [ ] **App Privacy** nutrition label
- [ ] **1024×1024 icon** + iPhone screenshots
- [ ] **Review notes:** premium demo account email + password (email-code OK)

## Reviewer demo account (you create)

```
Email: <premium subscriber test account>
Sign-in: email one-time code (or password if set)
Notes: Subscription managed on web; no in-app purchases. Pricing hidden in app.
```
