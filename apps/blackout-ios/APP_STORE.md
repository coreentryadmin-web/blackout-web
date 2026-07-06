# BlackOut iOS — App Store Connect (filled)

Use this as the single source of truth for IDs already registered.

| Field | Value |
|-------|--------|
| **Legal entity** | BLACKOUT TRADE LLC |
| **Team ID** | `ZA32C782N5` |
| **Bundle ID** | `com.blackout-trades.app` |
| **App Store Connect Apple ID** | `6787797476` |
| **SKU** | `blackout-ios-2020` |
| **Capacitor appId** | `com.blackout-trades.app` (matches bundle) |
| **WKWebView UA token** | `BlackOutiOSApp` (must match `blackout-web` `layout.tsx`) |

## Codemagic (recommended — no Mac)

1. [codemagic.io](https://codemagic.io) → add GitHub app
2. **Option A:** repo `coreentryadmin-web/blackout-ios` (standalone)
3. **Option B:** repo `coreentryadmin-web/blackout-web` → set **working directory** `apps/blackout-ios`
4. Integration **BlackOut ASC** (App Store Connect API `.p8`)
5. Run workflow **ios-release** → TestFlight (~15 min)

`codemagic.yaml` already has Apple ID `6787797476` and Team `ZA32C782N5`.

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

Provide in App Review Information:

```
Email: <premium subscriber test account>
Sign-in: email one-time code (or password if set)
Notes: Subscription managed on web; no in-app purchases. Pricing hidden in app.
```
