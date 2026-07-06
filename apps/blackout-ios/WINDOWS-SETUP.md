# Shipping BlackOut to the App Store from Windows (no Mac)

The whole flow: **Windows (edit + push) → Codemagic cloud Mac (build + sign) → App Store
Connect (submit)**. You never touch a Mac. Total cost = **$99/yr Apple** (Codemagic free
tier = 500 build min/month, enough for ~15+ builds).

Do the steps in order. Each "(you)" step needs a login/credential, so it's yours.

---

## STEP 1 — Apple Developer account (you) · ~15 min + up to 48h verification
1. Go to **developer.apple.com/programs** → **Enroll** → pay **$99/yr**.
   - If you have a company/LLC, enroll as an **Organization** (needs a D-U-N-S number, free)
     so the App Store seller name is the business, not your personal name. Otherwise
     **Individual** is fine and faster.
2. Apple may take a few hours to ~2 days to verify. Wait for "Membership active".

## STEP 2 — Create the app record in App Store Connect (you) · ~5 min
1. Go to **appstoreconnect.apple.com** → **My Apps → +** → **New App**.
2. Platform **iOS**, Name **BlackOut**, Primary language, Bundle ID **com.blackout-trades.app**
   (register it under **Certificates, IDs & Profiles → Identifiers** first if it's not listed).
3. After creating, copy the **Apple ID** number shown (a long number) → paste it into
   `codemagic.yaml` as `APP_STORE_APPLE_ID`.

## STEP 3 — App Store Connect API key (you) · ~3 min
This is what lets Codemagic sign + upload without a Mac.
1. App Store Connect → **Users and Access → Integrations → App Store Connect API**.
2. **Generate API Key**, role **App Manager**. Download the **.p8 file** (one-time download!),
   and note the **Key ID** and **Issuer ID**.

## STEP 4 — Get this repo on GitHub (you, one command) 
On this Windows machine:
```powershell
gh auth login          # one-time browser login
cd C:\Users\raidu\blackout-ios
gh repo create blackout-ios --private --source=. --remote=origin --push
```
(Or create an empty private repo at github.com/new and `git remote add origin <url>; git push -u origin main`.)

## STEP 5 — Codemagic (you) · ~10 min
1. Sign up at **codemagic.io** with your GitHub account (free tier).
2. **Add application** → pick the `blackout-ios` repo → it auto-detects `codemagic.yaml`.
3. **Team → Integrations → App Store Connect → Connect** → upload the **.p8**, enter
   **Key ID** + **Issuer ID** → name the integration **exactly** `BlackOut ASC`
   (must match `codemagic.yaml`).
4. Start a build of the **ios-release** workflow.

## STEP 6 — First build → TestFlight
- Codemagic builds the signed `.ipa` and uploads to **TestFlight** (~10–15 min).
- Install **TestFlight** from the App Store on your iPhone, sign in with your Apple ID →
  the BlackOut build appears → install it on your actual phone. 🎉

## STEP 7 — Submit to the App Store (you, web) · when ready
In App Store Connect, fill the listing (screenshots, description, privacy labels, support
URL), attach the build, and **Submit for Review**. Review takes ~1–3 days.

---

## ⚠️ Before you submit — the rejection-risk checklist (from our earlier review)
- [ ] **No in-app pricing / purchase links.** The app loads the live site; the `/upgrade`
      page with Whop checkout MUST be hidden when running inside the app, or Apple rejects
      it (guideline 3.1.1). *(Code change in the web app — ask me to add an "in-app" flag
      that hides purchase UI.)*
- [ ] **Demo account** with an active subscription in the review notes, so the reviewer
      sees the full desk past the login.
- [ ] **Account deletion** available in-app (guideline 5.1.1).
- [ ] No "guaranteed returns / win-rate" hype on screens the reviewer sees (finance scrutiny).
- [ ] "Educational, not financial advice" disclaimers visible (already in the UI).
- [ ] Google sign-in routed through the system browser, or use email-code login in-app
      (Google blocks OAuth inside webviews).

These are the things that get an app like this bounced. None are hard — but skipping them
means a rejection round.

---

## What I (Claude) can do for you on the Windows side
- The web-app change to **hide pricing/purchase UI when running inside the iOS app** (the
  #1 rejection risk) — ask and I'll implement + deploy it.
- Tweak `capacitor.config.ts` / `codemagic.yaml` as needed.
- Generate the app icon set + splash from a source logo.
- Walk you through each Codemagic build error if one comes up (the first signing build
  often needs one tweak).

## What needs you (credentials/payments — I can't do these)
- Apple enrollment + payment, App Store Connect app record + API key, Codemagic signup,
  GitHub auth, final "Submit for Review".
