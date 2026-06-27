# HTTPS / Network Health Monitor

Automated TLS, availability, security-header, redirect, and CDN health checks for `www.blackouttrades.com`.

## 2026-06-27 03:23 ET
### TLS: cert expires 2026-09-14 — 79 days remaining — **PASS** (CN=blackouttrades.com, issuer Google Trust Services WE1)
### Availability: all live routes healthy — **PASS**
- Landing 200 (710ms), Sign In 200 (321ms), Sign Up 200 (180ms)
- /grid 200 (150ms), /track-record 200, /api/health 200 (128ms)
- Protected page routes (/dashboard, /flows, /heatmap, /nighthawk, /terminal) → **404 by design**: Clerk `auth.protect()` returns 404 for signed-out requests (see `src/middleware.ts` isProtectedRoute). Not an outage — the monitor is unauthenticated.
- Auth-gated APIs returning 401 (working as intended): /api/market/gex-positioning, /api/market/flows, /api/market/spx/pulse
- **No 5xx. No P0.**
### Security Headers: 6/6 present — **PASS**
- Strict-Transport-Security, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Content-Security-Policy, Permissions-Policy all OK.
- WARN: `X-Powered-By: Next.js` leaking (minor info disclosure — consider `poweredByHeader: false` in next.config). `Server: cloudflare` is expected (CF edge).
### Redirects: **PASS** — http→https 301 → https://www.blackouttrades.com/ ; /pricing 307 → /#pricing
### CDN: **PASS** — Cloudflare edge (CF-Ray a122b2a79f0d5195-SEA), Railway request ID present, root Cache-Control `private, no-cache, no-store, max-age=0, must-revalidate`
### Monitor maintenance: corrected 2 stale probe paths in the task file this run
- `/api/market/spx-pulse` (404, nonexistent) → `/api/market/spx/pulse` (real, 401)
- `/api/flows` (404, nonexistent) → `/api/market/flows` (real, 401)
---
