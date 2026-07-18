# AGENTS.md

## Cursor Cloud specific instructions

BLACKOUT (`blackout-web`) is a single **Next.js 15 (App Router) / TypeScript** app with an iOS
Capacitor shell at **`apps/blackout-ios/`** (one repo — no separate `blackout-ios` GitHub repo).
Production and staging both run on **AWS ECS Fargate** (not Railway). The `railway.*.toml` files at
the repo root are a **legacy schedule catalog** only — live crons fire via **EventBridge → Lambda →
`GET /api/cron/*`** (see `docs/ops/RAILWAY-CRON-SCHEDULES.md` for UTC semantics). Commands live in
`package.json` (`dev`, `build`, `start`, `test`, `lint`, `lint:brand`, `lint:css`) and CI is
`.github/workflows/ci.yml`.

**Staging experiments** live in repo `blackout-web-sandbox`, branch `blackout-web-sandbox` — see
that repo's `AGENTS.md` for staging-only policy (never merge staging → prod without explicit request).

### Running / building
- Dev server: `npm run dev` → http://localhost:3000 (Next.js dev, hot reload). This is the only service locally.
- **Marketing vs app CSS:** `/`, `/pricing`, `/faq` live in `src/app/(marketing)/` and load lean
  `marketing-base.css` + `marketing-shell.css` only (no Clerk, no `globals.css`, no desk fonts).
  All product routes under `(site)/` load `globals.css` + `desk-app.css` via `AppShellProviders`.
- **SPX Slayer left rail:** `SpxGexMatrixHeatmap` — SPX **0DTE matrix** from `/api/market/gex-heatmap?ticker=SPX`, **GEX/VEX lens toggles**, live spot row in the ladder. Poll **8s RTH / 20s off-hours**; server cache **`SPX_GEX_HEATMAP_CACHE_SEC`** default **8** (other tickers stay `GEX_HEATMAP_CACHE_SEC` **20**). Bootstrap seeds matrix SWR via `/api/market/spx/bootstrap`.
- **BlackOut Thermal (`/heatmap`):** full `GexHeatmap.tsx` matrix shares **`src/lib/gex-heatmap-display.ts`** cell format/color scale with the SPX rail (GEX/VEX/DEX/CHARM lenses). Both surfaces read `cross_validation` from `/api/market/gex-heatmap` when preset tickers diverge from UW.
- **Market data process split (production ECS):**
  - **Web tier** (`blackout-production-web`): `PROCESS_ROLE=web`, `DATA_SOCKETS_ENABLED=0` — HTTP/UI only; reads Redis snapshots written by ingest.
  - **Market worker** (`blackout-production-market-worker`): `PROCESS_ROLE=ingest`, eager boot via `deploy/market-worker.mjs` → `/api/worker/boot`.
  - **Local dev:** no worker — WebSockets boot lazily on first `/api/market/*` request (`src/lib/ws/init-data-sockets.ts`).
- Blocking CI checks are `npx tsc --noEmit` and `npm run lint:brand`. `npm run lint` (ESLint/jsx-a11y)
  and `npm run lint:css` (stylelint) are **non-blocking** in CI (they emit warnings, `continue-on-error`).
- Tests: `npm test` (`node --test` via `tsx`, files `src/**/*.test.ts`). No DB/env needed for tests.

### iOS app (Capacitor shell)
- **Location:** `apps/blackout-ios/` — loads `https://blackouttrades.com` in WKWebView; `appendUserAgent: BlackOutiOSApp`.
- **Web detection:** `src/app/layout.tsx` adds `html.ios-app`; CSS hides in-app pricing (App Store 3.1.1).
- **Validate config:** `npm run validate:ios-config`
- **Cloud build:** root `codemagic.yaml` → connect **`coreentryadmin-web/blackout-web`** in Codemagic, workflow **`ios-release`**.
- **Setup:** `apps/blackout-ios/APP_STORE.md` (Apple ID `6787797476`, bundle `com.blackout-trades.app`).
- **Mobile UI E2E (Playwright):** `npm run test:ios-ui-e2e` — iPhone viewport + `BlackOutiOSApp` UA, Clerk temp-user auth, clicks every bottom tab + primary segment/control, screenshots → `/opt/cursor/artifacts/ios-ui-e2e/`. Requires `CLERK_SECRET_KEY` + publishable key. Static guards: `npm run validate:ios-mobile-desk`.

### Ops auto-fix (cron/errors → agent)
- **`npm run ops:collect`** — scan prod Postgres + live watchdog; JSON action items (exit 1 if any).
- **`.github/workflows/ops-auto-fix.yml`** — every 20 min + on audit failures → GitHub issue (`ops-auto-fix` label) + Cursor Cloud Agent.
- Runbook: `docs/ops/OPS-AUTO-FIX.md`. Cloud agents: fix action items before other work; do not ask the user.

### Local environment / secrets
- The app **degrades gracefully** with no env vars: the landing page, `/sign-in`, `/sign-up`,
  `/track-record`, and `/api/health` all work, and every external integration (Postgres, Redis,
  Unusual Whales, Massive/Polygon, Anthropic, Whop, Discord, Sentry, web-push) is guarded and inert
  when its key is absent. There is no `.env.example`.
- Put local config in `.env.local` (gitignored). Next.js auto-loads it.

### Auth (Clerk) — no real keys needed locally
- With no Clerk keys set, `@clerk/nextjs` runs in **keyless development mode**: on first run it
  provisions a temporary dev instance and writes keys to a local `.clerk/` dir (gitignored — do not
  commit it). Full sign-up / sign-in works locally without any secret.
- To sign up in dev, use a Clerk **test email** (any address containing `+clerk_test`, e.g.
  `you+clerk_test@example.com`) and the dev verification code **`424242`** — this bypasses real email.
- The `users` table is populated **only** by the Clerk webhook (`/api/webhooks/clerk`), which does not
  fire in keyless mode, so the table stays empty after a local sign-up even though the Clerk session is
  fully authenticated. This is expected, not a bug.
- Free-tier authenticated users are intentionally redirected from `/dashboard` to `/upgrade` (tier
  gating via Whop). Premium tools (`/flows`, `/terminal`, `/heatmap`, `/nighthawk`) require both a
  paid tier and market-data API keys (`UW_API_KEY`, `POLYGON_API_KEY`/`MASSIVE_API_KEY`), so they
  cannot be fully exercised locally without those third-party keys.
- **Gotcha — keyless mode only applies when NO Clerk keys are set.** If this cloud environment has
  **production** Clerk keys injected as secrets (`CLERK_SECRET_KEY` / `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
  present in env), `@clerk/nextjs` uses them and they are **domain-locked to `blackouttrades.com`** —
  localhost sign-in then fails hard. To test authed/premium UI on prod, mint a one-time Clerk
  `sign_in_token` via the Backend API and open
  `https://blackouttrades.com/sign-in?__clerk_ticket=<token>`, then delete the test user afterward.
- **Rendering authed pages on localhost:** unset prod Clerk keys so keyless mode engages, e.g.
  `env -u CLERK_SECRET_KEY -u NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY npm run dev`. Use Backend API +
  `__clerk_ticket` to bypass Turnstile in headless environments (see prior cloud-agent notes).

### Premium tool launch gate (LAUNCHED_TOOLS)
- Non-admin premium users only see tools where `isToolLaunched()` is true (SPX Slayer + HELIX by default;
  others need `LAUNCHED_TOOLS=heatmap,nighthawk,largo,grid` in Secrets Manager / ECS task env).
- **Check:** `/admin` → **Tool launch status**, or `GET /api/admin/launch-status` (admin-gated).
- **Ops guardrails:** `/admin` → Operations → **System Vitals** via `GET /api/admin/health` (`ops_config`).

### AWS production (Cursor Cloud agents)
- **Deploy:** push/merge to `main` → `.github/workflows/ecr-push-production.yml` → ECR image tag `$GITHUB_SHA` → ECS `blackout-production-web` rollout → Cloudflare purge. Post-merge smoke: `.github/workflows/deploy-smoke.yml`.
- **Cluster / services:** `blackout-production-cluster` — `blackout-production-web` (autoscale min **8**, max **15**) + `blackout-production-market-worker` (desired **1**).
- **Secrets:** `blackout-production/app/env` in Secrets Manager — manifest: `docs/ops/AWS-SECRETS-MANIFEST.md`.
- **Crons:** **31** EventBridge rules → Lambda `blackout-production-hit-cron` → `https://blackouttrades.com/api/cron/*` with Bearer `CRON_SECRET`. Schedule source: sync `blackout-infra/scripts/sync-cron-schedules.mjs` from `railway.*.toml`.
- **Logs:** CloudWatch `/ecs/blackout-production`, `/ecs/blackout-production-market-worker`.
- **Health:** ALB → `/api/ready` (90s start); liveness `/api/health`.
- **Postgres:** RDS Postgres 16 Multi-AZ + **RDS Proxy** (`DATABASE_URL` points at proxy). `PG_STATEMENT_TIMEOUT_MS=0` required for proxy.
- **`REPLICA_COUNT`:** must match running **web** task count for UW 2 RPS budget + pool math — bump in Secrets Manager when autoscale min changes (see `blackout-infra/docs/ops/PROD-AWS-MIGRATION-RUNBOOK.md` §4b).
- **Legacy Railway scripts/workflows** (`scripts/railway-*.mjs`, `railway-audit-apply.yml`) are **deprecated** — do not use for prod ops.
- **Infra Terraform:** repo `blackout-infra`; runbook `blackout-infra/docs/ops/PROD-AWS-MIGRATION-RUNBOOK.md`.

### UW WebSocket → cache / HELIX (2 RPS budget)
- Multiplex channels in `src/lib/live-api-integrations.ts` (`UW_WS_CHANNELS`). Ticker-scoped joins:
  `option_trades:SPX,SPY`, `lit_trades:SPY`, `net_flow:SPX,SPY,QQQ,IWM` (override via
  `UW_WS_*_TICKERS` env vars).
- High-premium `option_trades` prints persist to HELIX via `persistAndPublishFlowAlert` (same path as
  `flow_alerts`).
- `uw-ws-cache-bridge.ts` seeds Redis from WS stores; `uw-cache-refresh` cron skips REST tasks when the
  matching channel is fresh (`market_tide`, `net_flow`, `option_trades`).
- **Production:** upstream WS owned by **market worker**; web tier reads Redis.

### Massive LULD halt feed (second source vs UW `trading_halts`)
- Opt-in: set `STOCKS_WS_ENABLED=1` (or `LULD_WS_ENABLED=1`) in Secrets Manager. Uses the same
  `POLYGON_API_KEY` / `MASSIVE_API_KEY` as indices/options.
- Subscribes to `LULD.SPY` by default (`LULD_WS_TICKERS` override). SPY LULD halts proxy to SPX/SPXW
  play gates via `LULD_INDEX_PROXIES` in `live-api-integrations.ts`.
- Halt feed considered stale only when **both** UW and LULD are down (when LULD is enabled). Admin:
  Operations → **Massive LULD** tile; cron `GET /api/cron/socket-health` includes `stocks_luld`.

### Cloudflare (edge — not Next.js headers in prod)
- Production is fronted by **Cloudflare** → **AWS ALB**. Security **response headers** are delivered by
  Cloudflare Transform Rules — **not** by the `headers()` block in `next.config.mjs`.
- CSP mirrors `baseCsp` in `next.config.mjs` — keep code and CF rules in sync. See `docs/CLOUDFLARE_CONFIG.md`.

### Postgres (optional, for persistence testing)
- The app runs fine without a DB (`/api/health` returns `db: "skipped"`). Postgres is only needed to
  exercise persistence (flows, SPX plays, nighthawk, positions, telemetry, etc.).
- There is **no migration command** — the schema is auto-created via `ensureSchema()` on the first
  `dbQuery()` (e.g. hitting `GET /api/track-record` creates all ~20 tables).
- Local Postgres 16: `sudo pg_ctlcluster 16 main start`; `.env.local`:
  `DATABASE_URL=postgres://postgres:postgres@localhost:5432/blackout`, `DATABASE_SSL=0`.

### Merge policy (standing — confirmed 2026-07-06)

**Auto-merge every verified PR into `main`** once local checks and required CI (`verify`) are green.
Do not ask the user for merge approval unless the user explicitly says otherwise (e.g. "do not auto merge").
Workflow:

1. Branch (`fix/*` or `cursor/*`) → commit → push → open PR to `main`
2. Run local verification (tsc/test as applicable)
3. Poll ECS deploy → `npm run validate:deploy`
4. Enable auto-merge only when user/policy allows: `gh pr merge <n> --auto --squash --delete-branch`

Full policy + exceptions: **`CLAUDE.md`** § Merge authorization.

### Autonomous RTH resume (Cloud Agent — do NOT wait for user)

On **every weekday** Cloud Agent session when **America/New_York ≥ 09:00**:

1. Read and execute `docs/ops/RTH-OPEN-RUNBOOK.md` **before** other work.
2. Run `npm run validate:rth-open` (wraps `validate:deploy` + RTH session checks).
3. If anything fails → fix → branch → PR → merge per policy → poll ECS deploy → re-run until GREEN.
4. After **09:35 ET**, confirm `spx-evaluate` cron + options-socket `authenticated` in CloudWatch logs.

Off-hours / weekends: RTH script skips automatically; still run `npm run validate:deploy` after pushes to `main`.
