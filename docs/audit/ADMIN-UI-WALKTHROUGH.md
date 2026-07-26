# Admin UI walkthrough — authenticated rendered-pixel capture on demand

`scripts/admin-ui-walkthrough.mjs` + `.github/workflows/admin-ui-walkthrough.yml` produce **real
screenshots of the LIVE, signed-in desk** — every authenticated page plus the new Vector chart
layers and intel-rail / board controls toggled and captured.

It exists because **the agent sandbox's headless browser cannot reach prod** — Chromium egress is
reset on every host (`net::ERR_CONNECTION_RESET`, proven incl. example.com, proxy on/off). So pixel
/ visual QA of the authenticated UI has to run on a **GitHub Actions runner** (which has real
egress), exactly like the public-only `desktop-ui-e2e` sibling. This walkthrough is its
**authenticated superset**: it logs in as a temp admin first, then walks the desk.

## How to trigger

GitHub → **Actions** → **admin-ui-walkthrough** → **Run workflow**. Optional `base` input
(defaults to `https://blackouttrades.com`) if you want to point it at another origin.

## Required repo secrets

The Clerk mint helper (`scripts/audit/lib/ios-playwright-auth.mjs`) reads exactly two env vars,
wired from repo secrets in the workflow:

- `CLERK_SECRET_KEY`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`

Set both under **Settings → Secrets and variables → Actions**. Without them the run exits `1`
(auth mint failed) — there is no authenticated walk to run.

## What it does

1. Mints a **temp admin + premium Clerk user**, does the FAPI ticket exchange, and gets the
   `__session` / `__client_uat` cookies. The temp user is **DELETED** in a `finally` (`cleanup()`).
2. Applies those cookies to a plain **desktop** Playwright context (1440×900, `reducedMotion:reduce`)
   — NOT the iOS UA/device the `ios-*-ui-e2e` suites use.
3. Navigates and full-page-screenshots each authenticated page: `/nighthawk`, `/dashboard`,
   `/vector`, `/vector?ticker=SPX`.
4. Per-page interactions (each wrapped in try/catch — a missing control is a logged note, never a
   failure), screenshotting after each:
   - **Vector chart** (`/vector`, `/vector?ticker=SPX`, and the `/dashboard` embed): opens the
     indicator menu (`data-testid="vector-indicator-trigger"`) and enables the new **Gamma regime**
     and **Expected move** layers (and any **cone**-labelled toggle), by menu-label substring
     against `VECTOR_INDICATOR_GROUPS` in `src/features/vector/lib/vector-indicators-config.ts`.
   - **/dashboard**: the `SpxIntelRail` **⚡ Pulse ⇄ Largo** toggle, plus a Pulse row's
     **→ chart** jump if present.
   - **/nighthawk**: board status tabs (open/watch/closed) / Night's Watch ⇄ Playbook segments and,
     if a play terminal is mounted, its **Thesis / Management / PnL** tabs.

## Where the screenshots land

Uploaded as the **`admin-ui-walkthrough`** artifact on the workflow run (retention 7 days),
alongside `report.json` (pages walked, per-page HTTP status, every interaction's
found/clicked/notfound/error outcome, and per-page console errors). Download the artifact from the
run summary. Secrets are never printed.

## Exit behavior

Exits non-zero **only on a hard failure** — the admin mint failed, or every page failed to load.
A single missing control (a toggle a copy change renamed, a terminal that isn't mounted off-hours)
is recorded in `report.json` and does not fail the run.
