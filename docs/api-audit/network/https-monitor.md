# HTTPS / Network Health Monitor

Automated TLS, availability, security-header, redirect, and CDN health checks for `www.blackouttrades.com`.

## 2026-06-30 07:22 ET
### TLS: cert expires 2026-09-14 — 76 days remaining — **PASS** (CN=blackouttrades.com, issuer Google Trust Services WE1; handshake valid)
### Availability: 12/12 routes healthy — **PASS**
- Pages 200 (Accept:text/html, follows redirects): Landing 623ms, Sign In 283ms, Sign Up 188ms, /dashboard 240ms, /flows 262ms, /heatmap 237ms, /grid 169ms, /nighthawk 257ms; /api/health 200 (115ms)
- Auth-gated APIs 401 as intended (~100–110ms): /api/market/spx/pulse, /api/market/gex-positioning, /api/market/flows
- **No 5xx. No P0. No slow routes (all <650ms).**
### Security Headers: 6/6 present on canonical apex page — **PASS** (HSTS max-age=, X-Content-Type-Options nosniff, X-Frame-Options SAMEORIGIN, Referrer-Policy strict-origin, CSP default-src, Permissions-Policy camera=()). Step-3 apex-probe fix holding — no CSP false alarm.
- `X-Powered-By` not leaking. `Server: cloudflare` expected (CF edge header, not an app leak).
### Redirects: **PASS** — `http://www/` → 301 → https://blackouttrades.com/ ; www `/pricing` → 301 → https://blackouttrades.com/pricing (canonical = apex).
### CDN: **PASS** — Cloudflare edge (CF-Ray a13cca98df7dfbea-SEA), X-Railway-Request-Id present. Landing `Cache-Control: s-maxage=31536000` (Age 2948s, marketing force-static + CF edge cache). Dynamic API pulse returns 401 (auth gate) so Cache-Control unreadable this probe — not a caching regression.
---

## 2026-06-29 13:22 ET
### TLS: cert expires 2026-09-14 — 77 days remaining — **PASS** (CN=blackouttrades.com, issuer Google Trust Services WE1; handshake valid)
### Availability: 12/12 routes healthy — **PASS** (1 transient slow landing, see below)
- Pages 200 (Accept:text/html, follows redirects): Landing 7986ms ⚠️, Sign In 283ms, Sign Up 903ms, /dashboard 307ms, /flows 504ms, /heatmap 303ms, /grid 282ms, /nighthawk 274ms; /api/health 200 (114ms)
- Auth-gated APIs 401 as intended (~90–115ms): /api/market/spx/pulse, /api/market/gex-positioning, /api/market/flows
- **No 5xx. No P0.** WARN: Landing first-hit 7986ms (>3s). Read as a one-off CF cache-miss/origin cold-start, NOT systemic: the Step-5 landing refetch this same run returned cached (`Age: 1493s`) and fast, and prior runs were ~440ms. Watch next cycle — escalate only if it recurs.
### Security Headers: 6/6 present on canonical apex page — **PASS** (HSTS max-age=, X-Content-Type-Options nosniff, X-Frame-Options SAMEORIGIN, Referrer-Policy strict-origin, CSP default-src, Permissions-Policy camera=()). Step-3 apex-probe fix holding — no CSP false alarm.
- `X-Powered-By` not leaking. `Server: cloudflare` expected (CF edge header, not an app leak).
### Redirects: **PASS** — `http://www/` → 301 → https://blackouttrades.com/ ; www `/pricing` → 301 → https://blackouttrades.com/pricing (canonical = apex).
### CDN: **PASS** — Cloudflare edge (CF-Ray a1369cb87c3775f1-SEA), X-Railway-Request-Id present. Landing `Cache-Control: s-maxage=31536000` (Age 1493s, marketing force-static + CF edge cache). /api/health carries no Cache-Control (dynamic, not CDN-cached — correct).
---

## 2026-06-29 11:22 ET
### TLS: cert expires 2026-09-14 — 77 days remaining — **PASS** (CN=blackouttrades.com, issuer Google Trust Services WE1; handshake valid)
### Availability: 12/12 routes healthy — **PASS**
- Pages 200 (Accept:text/html, follows redirects): Landing 467ms, Sign In 184ms, Sign Up 293ms, /dashboard 200ms, /flows 269ms, /heatmap 245ms, /grid 135ms, /nighthawk 238ms; /api/health 200 (116ms)
- Auth-gated APIs 401 as intended (~90–95ms): /api/market/spx/pulse, /api/market/gex-positioning, /api/market/flows
- **No 5xx. No slow routes (>3s). No P0.**
### Security Headers: 6/6 present on canonical apex page — **PASS** (HSTS max-age=31536000, X-Content-Type-Options nosniff, X-Frame-Options SAMEORIGIN, Referrer-Policy strict-origin, CSP default-src, Permissions-Policy camera=()). Step-3 apex-probe fix holding — no CSP false alarm.
- `X-Powered-By` not leaking. `Server: cloudflare` expected (CF edge header, not an app leak).
### Redirects: **PASS** — `http://www/` → 301 → https://blackouttrades.com/ ; www `/pricing` → 301 → https://blackouttrades.com/pricing (canonical = apex).
### CDN: **PASS** — Cloudflare edge (CF-Ray a135ec9ca9d40239-SEA), X-Railway-Request-Id present. Landing `Cache-Control: s-maxage=31536000` (Age 5557s, marketing force-static + CF edge cache). /api/health carries no Cache-Control (dynamic, not CDN-cached — correct).
---

## 2026-06-29 07:22 ET
### TLS: cert expires 2026-09-14 — 77 days remaining — **PASS** (CN=blackouttrades.com, issuer Google Trust Services WE1; handshake valid)
### Availability: 12/12 routes healthy — **PASS**
- Pages 200 (Accept:text/html, follows redirects): Landing 441ms, Sign In 270ms, Sign Up 236ms, /dashboard 235ms, /flows 332ms, /heatmap 253ms, /grid 162ms, /nighthawk 322ms; /api/health 200 (84ms)
- Auth-gated APIs 401 as intended (~95–98ms): /api/market/spx/pulse, /api/market/gex-positioning, /api/market/flows
- **No 5xx. No slow routes (>3s). No P0.**
### Security Headers: 6/6 present on canonical apex page — **PASS** (HSTS max-age=31536000 includeSubDomains preload, X-Content-Type-Options nosniff, X-Frame-Options SAMEORIGIN, Referrer-Policy strict-origin-when-cross-origin, CSP default-src, Permissions-Policy camera=()). Step-3 apex-probe fix holding — no CSP false alarm.
- `X-Powered-By` not leaking. `Server: cloudflare` expected (CF edge header, not an app leak).
### Redirects: **PASS** — `http://www/` → 301 → https://blackouttrades.com/ ; www `/pricing` → 301 → https://blackouttrades.com/pricing (canonical = apex).
### CDN: **PASS** — Cloudflare edge (CF-Ray a1348d21fb6475f4-SEA), X-Railway-Request-Id present. Landing `Cache-Control: s-maxage=31536000` (Age 5704s, marketing force-static + CF edge cache). /api/health → `Cf-Cache-Status: DYNAMIC` (empty Cache-Control but Cloudflare correctly treats as uncached — Step-5 "may be cached" WARN is a confirmed false positive). Origin via X-Railway-Edge lax1.
---

## 2026-06-29 05:22 ET
### TLS: cert expires 2026-09-14 — 77 days remaining — **PASS** (CN=blackouttrades.com, issuer Google Trust Services WE1; handshake valid)
### Availability: 12/12 routes healthy — **PASS**
- Pages 200 (Accept:text/html, follows redirects): Landing 557ms, Sign In 207ms, Sign Up 180ms, /dashboard 947ms, /flows 227ms, /heatmap 236ms, /grid 243ms, /nighthawk 215ms; /api/health 200 (147ms)
- Auth-gated APIs 401 as intended (~92–99ms): /api/market/spx/pulse, /api/market/gex-positioning, /api/market/flows
- **No 5xx. No slow routes (>3s). No P0.**
### Security Headers: 6/6 present on canonical apex page — **PASS** (HSTS max-age=, X-Content-Type-Options nosniff, X-Frame-Options SAMEORIGIN, Referrer-Policy strict-origin, CSP default-src, Permissions-Policy camera=()). Step-3 apex-probe fix holding — no CSP false alarm.
- `X-Powered-By` not leaking. `Server: cloudflare` expected (CF edge header, not an app leak).
### Redirects: **PASS** — `http://www/` → 301 → https://blackouttrades.com/ ; www `/pricing` → 301 → https://blackouttrades.com/pricing (canonical = apex).
### CDN: **PASS** — Cloudflare edge (CF-Ray a133dd23b858ba27-SEA), X-Railway-Request-Id present. Landing `Cache-Control: s-maxage=31536000` (Age 5764s, marketing force-static + CF edge cache). /api/health carries no Cache-Control (dynamic, not CDN-cached — correct).
---

## 2026-06-28 15:23 ET
### TLS: cert expires 2026-09-14 — 78 days remaining — **PASS** (CN=blackouttrades.com, issuer Google Trust Services WE1; handshake valid)
### Availability: 12/12 routes healthy — **PASS**
- Pages 200 (Accept:text/html, follows redirects): Sign In 248ms, Sign Up 196ms, /dashboard 283ms, /flows 309ms, /heatmap 318ms, /grid 186ms, /nighthawk 301ms; /api/health 200 (110ms)
- Auth-gated APIs 401 as intended (~106–129ms): /api/market/spx/pulse, /api/market/gex-positioning, /api/market/flows
- **No 5xx. No P0.**
- ⚠️ WARN (transient, self-resolved): Landing first-hit 15903ms on cold session start (DNS+TLS+origin cold). Immediate 3× re-probe = 355/128/112ms, all `CF-Cache-Status: HIT` (Age 1880s). Not persistent — first-request spike only.
### Security Headers: 6/6 present on canonical apex page — **PASS** (HSTS max-age=31536000 includeSubDomains preload, X-Content-Type-Options nosniff, X-Frame-Options SAMEORIGIN, Referrer-Policy strict-origin-when-cross-origin, CSP default-src, Permissions-Policy camera=()). Step-3 apex-probe fix holding — no CSP false alarm.
- `X-Powered-By` not leaking. `Server: cloudflare` expected (CF edge header, not an app leak).
### Redirects: **PASS** — `http://www/` → 301 → https://blackouttrades.com/ ; www `/pricing` → 301 → https://blackouttrades.com/pricing (canonical = apex).
### CDN: **PASS** — Cloudflare edge (CF-Ray a12f1001e8cf683a-SEA), X-Railway-Request-Id present. Landing `Cache-Control: s-maxage=31536000` (Age 1860s, marketing force-static + CF edge cache). Auth-gated API 401 carries no Cache-Control (Clerk rejects at edge before route headers; real route cache policy not measurable unauthenticated — inconclusive, not a finding).
---

## 2026-06-28 13:21 ET
### TLS: cert expires 2026-09-14 — 78 days remaining — **PASS** (CN=blackouttrades.com, issuer Google Trust Services WE1; handshake valid)
### Availability: 12/12 routes healthy — **PASS**
- Pages 200 (Accept:text/html, follows redirects): Landing 756ms, Sign In 228ms, Sign Up 183ms, /dashboard 252ms, /flows 296ms, /heatmap 267ms, /grid 155ms, /nighthawk 260ms; /api/health 200 (106ms)
- Auth-gated APIs 401 as intended (~94–127ms): /api/market/spx/pulse, /api/market/gex-positioning, /api/market/flows
- **No 5xx. No P0. No slow routes (all <800ms).**
### Security Headers: 6/6 present on canonical apex page — **PASS** (HSTS max-age, X-Content-Type-Options nosniff, X-Frame-Options SAMEORIGIN, Referrer-Policy strict-origin, CSP default-src, Permissions-Policy camera=()). Step-3 apex-probe fix holding — no CSP false alarm.
- `X-Powered-By` not leaking. `Server: cloudflare` expected (CF edge header, not an app leak).
### Redirects: **PASS** — `http://www/` → 301 → https://blackouttrades.com/ ; www `/pricing` → 301 → https://blackouttrades.com/pricing (canonical = apex).
### CDN: **PASS** — Cloudflare edge (CF-Ray a12e5df42984297d-SEA), X-Railway-Request-Id present. Landing `Cache-Control: s-maxage=31536000` (Age 16s, marketing force-static + CF edge cache). Auth-gated API 401 carries no Cache-Control (not CDN-cached).
---

## 2026-06-28 11:22 ET
### TLS: cert expires 2026-09-14 — 78 days remaining — **PASS** (CN=blackouttrades.com, issuer Google Trust Services WE1; handshake valid)
### Availability: 12/12 routes healthy — **PASS**
- Pages 200 (Accept:text/html, follows redirects): Landing 578ms, Sign In 261ms, Sign Up 154ms, /dashboard 206ms, /flows 245ms, /heatmap 204ms, /grid 134ms, /nighthawk 298ms; /api/health 200 (87ms)
- Auth-gated APIs 401 as intended (~85–107ms): /api/market/spx/pulse, /api/market/gex-positioning, /api/market/flows
- **No 5xx. No P0. No slow routes (all <600ms).**
### Security Headers: 6/6 present on canonical apex page — **PASS** (HSTS max-age, X-Content-Type-Options nosniff, X-Frame-Options SAMEORIGIN, Referrer-Policy strict-origin, CSP default-src, Permissions-Policy camera=()). Step-3 apex-probe fix holding — no CSP false alarm.
- `X-Powered-By` not leaking. `Server: cloudflare` expected (CF edge header, not an app leak).
### Redirects: **PASS** — `http://www/` → 301 → https://blackouttrades.com/ ; www `/pricing` → 301 → https://blackouttrades.com/pricing (canonical = apex).
### CDN: **PASS** — Cloudflare edge (CF-Ray a12dafb1ef52def6-SEA), X-Railway-Request-Id present. Landing `Cache-Control: s-maxage=31536000` (Age 207s, marketing force-static + CF edge cache). /api/health carries no Cache-Control (dynamic, not CDN-cached).
---

## 2026-06-28 09:22 ET
### TLS: cert expires 2026-09-14 — 78 days remaining — **PASS** (CN=blackouttrades.com, issuer Google Trust Services WE1; handshake valid)
### Availability: 12/12 routes healthy — **PASS**
- Pages 200 (Accept:text/html, follows redirects): Landing 626ms, Sign In 266ms, Sign Up 145ms, /dashboard 219ms, /flows 201ms, /heatmap 202ms, /grid 124ms, /nighthawk 213ms; /api/health 200 (97ms)
- Auth-gated APIs 401 as intended (~91–93ms): /api/market/spx/pulse, /api/market/gex-positioning, /api/market/flows
- **No 5xx. No P0. No slow routes (all <650ms).**
### Security Headers: 6/6 present on canonical apex page — **PASS** (HSTS max-age, X-Content-Type-Options nosniff, X-Frame-Options SAMEORIGIN, Referrer-Policy strict-origin, CSP default-src, Permissions-Policy camera=()). Step-3 apex-probe fix holding — no CSP false alarm.
- `X-Powered-By` not leaking. `Server: cloudflare` expected (CF edge header, not an app leak).
### Redirects: **PASS** — `http://www/` → 301 → https://blackouttrades.com/ ; www `/pricing` → 301 → https://blackouttrades.com/pricing (canonical = apex).
### CDN: **PASS** — Cloudflare edge (CF-Ray a12cffcb4d18ba45-SEA), X-Railway-Request-Id present. Landing `Cache-Control: s-maxage=31536000` (marketing force-static + CF edge cache). Auth-gated API 401 carries no Cache-Control (not CDN-cached).
---

## 2026-06-28 07:23 ET
### TLS: cert expires 2026-09-14 — 78 days remaining — **PASS** (CN=blackouttrades.com, issuer Google Trust Services WE1; handshake valid)
### Availability: 12/12 routes healthy — **PASS**
- Pages 200 (Accept:text/html, follows redirects): Landing 611ms, Sign In 209ms, Sign Up 170ms, /dashboard 402ms, /flows 209ms, /heatmap 223ms, /grid 154ms, /nighthawk 234ms; /api/health 200 (93ms)
- Auth-gated APIs 401 as intended (~101–108ms): /api/market/spx/pulse, /api/market/gex-positioning, /api/market/flows
- **No 5xx. No P0. No slow routes (all <650ms).**
### Security Headers: 6/6 present on rendered apex page — **PASS** (HSTS max-age=31536000 includeSubDomains preload, X-Content-Type-Options nosniff, X-Frame-Options SAMEORIGIN, Referrer-Policy strict-origin-when-cross-origin, CSP `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://s.tradingview…`, Permissions-Policy camera=()/microphone=()/geolocation=())
- **Recurring CSP false alarm — ROOT-CAUSED and FIXED this run.** Step 3 probed `https://www.blackouttrades.com/` with `-MaximumRedirection 0`, so it measured Cloudflare's `www → apex` **301 redirect hop**, which carries HSTS/XFO/Referrer/Permissions but NOT CSP → false "CSP MISSING". Verified the real page is healthy: apex `https://blackouttrades.com/` → 200 with full CSP (CF-Cache-Status HIT); dynamic `/sign-in` → 200 with CSP (CF-Cache-Status DYNAMIC). CSP is configured globally in `next.config.mjs` (`baseCsp`) and present on every real response. **Applied fix:** changed Step 3 in the task SKILL.md to probe the canonical apex (`https://blackouttrades.com/`, returns 200 directly) instead of the www redirect hop, with a comment explaining why. This false alarm should not recur.
- `X-Powered-By` not leaking (poweredByHeader:false). `Server: cloudflare` expected (CF edge header, not an app leak).
### Redirects: **PASS** — `http://www/` → 301 → https://blackouttrades.com/ ; www `/pricing` → 301 → https://blackouttrades.com/pricing (canonical = apex).
### CDN: **PASS** — Cloudflare edge (CF-Ray a12c502b9861ba00-SEA), X-Railway-Request-Id present. Landing served from edge cache (CF-Cache-Status HIT, Age 1164s, `Cache-Control: s-maxage=31536000`) — consistent with marketing force-static + CF edge-cache design. /api/health carries no Cache-Control (dynamic, not CDN-cached).
---

## 2026-06-28 05:23 ET
### TLS: cert expires 2026-09-14 — 78 days remaining — **PASS** (CN=blackouttrades.com, issuer Google Trust Services WE1; handshake valid)
### Availability: 12/12 routes healthy — **PASS**
- Pages 200 (Accept:text/html, follows redirects): Landing 520ms, Sign In 221ms, Sign Up 150ms, /dashboard 250ms, /flows 234ms, /heatmap 239ms, /grid 117ms, /nighthawk 227ms; /api/health 200 (110ms)
- Auth-gated APIs 401 as intended (~85–97ms): /api/market/spx/pulse, /api/market/gex-positioning, /api/market/flows
- **No 5xx. No P0. No slow routes (all <550ms).**
### Security Headers: 6/6 present on rendered apex page — **PASS** (HSTS max-age=31536000 includeSubDomains preload, X-Content-Type-Options nosniff, X-Frame-Options SAMEORIGIN, Referrer-Policy strict-origin-when-cross-origin, CSP `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://s.tradingview…` (522 chars), Permissions-Policy camera=())
- Reading note (recurring false alarm, confirmed again): Step-3's probe omits `Accept: text/html` and uses `MaximumRedirection 0`, so it hits Clerk's protect-rewrite path (which strips CSP) and falsely reports "CSP MISSING". Re-probed apex with `Accept: text/html` → CSP present (522 chars, CF-Cache-Status HIT). Step 3 should send the Accept header like Step 2 does. No app defect.
- Config-vs-live deltas (both benign, no action — confirmed again): HSTS live `max-age=31536000` (1yr) vs next.config `63072000` (2yr); Permissions-Policy live omits the `payment=()` config sets. Edge normalization at Cloudflare; the three sensitive directives (camera/microphone/geolocation) are all locked and preload requirements still met.
- `X-Powered-By` not leaking (poweredByHeader:false applied). `Server: cloudflare` expected (CF edge header, not an app leak).
### Redirects: **PASS** — `http://www/` → 301 → https://blackouttrades.com/ ; www `/pricing` → 301 → https://blackouttrades.com/pricing (canonical = apex).
### CDN: **PASS** — Cloudflare edge (CF-Ray a12ba0394ba4ddb8-SEA), X-Railway-Request-Id present. Landing served from edge cache (CF-Cache-Status HIT, `Cache-Control: s-maxage=31536000`) — consistent with marketing force-static + CF edge-cache design; all security headers (incl. CSP) intact on the cached response. /api/health carries no Cache-Control (dynamic, not CDN-cached).
---

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

## 2026-06-27 07:14 ET
### TLS: cert expires 2026-09-14 — 79 days remaining — **PASS** (CN=blackouttrades.com, issuer Google Trust Services WE1)
### Availability: all live routes healthy — **PASS**
- Landing 200 (509ms), Sign In 200 (234ms), Sign Up 200 (201ms), /grid 200 (491ms), /track-record 200, /api/health 200 (132ms)
- **Root-caused the protected-route "404"** (refines the 03:23 entry): it is a *non-document request* artifact, **not** a blanket "404 for signed-out." Clerk `auth.protect()` only 404-rewrites probes that lack a browser `Accept` header (the monitor sent `Accept: */*` → header `X-Clerk-Auth-Reason: protect-rewrite`, `X-Middleware-Rewrite: /clerk_…`). Re-probed all five (`/dashboard /flows /heatmap /nighthawk /terminal`) with `Accept: text/html` → **307 → /sign-in?redirect_url=…** every time. Real browsers/users are redirected correctly; routes are healthy.
- Auth-gated APIs 401 as intended: /api/market/gex-positioning, /api/market/flows, /api/market/spx/pulse
- **No 5xx. No P0.**
### Security Headers: 6/6 present — **PASS** (HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, CSP, Permissions-Policy)
- WARN (unchanged, low priority): `X-Powered-By: Next.js` leaking → `poweredByHeader: false` in next.config to harden. `Server: cloudflare` expected.
### Redirects: **PASS** — http→https 301 → https://www.blackouttrades.com/ ; /pricing 307 → /#pricing
### CDN: **PASS** — Cloudflare edge (CF-Ray a12402125a5176d4-SEA), Railway request ID present, root Cache-Control `private, no-cache, no-store, max-age=0, must-revalidate`
### Monitor calibration note
- The Step 2 availability probe should send `Accept: text/html` for page routes so protected routes report their true **307→/sign-in** instead of a misleading 404. APIs correctly return 401 (already not counted as failures — only 5xx is). No code/app defect found this run.
---

## 2026-06-27 07:21 ET
### TLS: cert expires 2026-09-14 — 79 days remaining — **PASS** (CN=blackouttrades.com, issuer Google Trust Services WE1)
### Availability: 12/12 routes healthy — **PASS**
- Landing 200 (554ms), Sign In 200 (258ms), Sign Up 200 (301ms), /api/health 200 (139ms)
- Protected page routes followed to **200 sign-in** (task file now sends `Accept: text/html` → true 307→/sign-in chain): /dashboard 200 (344ms), /flows 200 (330ms), /heatmap 200 (405ms), /grid 200 (159ms), /nighthawk 200 (334ms)
- Auth-gated APIs 401 as intended (~134–159ms): /api/market/spx/pulse, /api/market/gex-positioning, /api/market/flows
- **No 5xx. No P0. No slow routes (all <600ms).**
### Security Headers: 6/6 present — **PASS** (HSTS max-age=63072000 +preload, X-Content-Type-Options nosniff, X-Frame-Options SAMEORIGIN, Referrer-Policy strict-origin-when-cross-origin, CSP default-src 'self', Permissions-Policy camera=())
- WARN (unchanged, low priority): `X-Powered-By: Next.js` leaking → harden with `poweredByHeader: false` in next.config. `Server: cloudflare` expected (CF edge).
### Redirects: **PASS** — http→https 301 → https://www.blackouttrades.com/ ; /pricing 307 → /#pricing
### CDN: **PASS** — Cloudflare edge (CF-Ray a12411551a60c643-SEA), Railway request ID present, root Cache-Control `private, no-cache, no-store, max-age=0, must-revalidate`. The Step-5 "API may be cached" WARN is a false positive: the unauthenticated SPX-pulse probe 401s with no Cache-Control header, so the check has nothing to read — not a real caching exposure.
---

## 2026-06-27 13:22 ET
### TLS: cert expires 2026-09-14 — 79 days remaining — **PASS** (CN=blackouttrades.com, issuer Google Trust Services WE1; cert covers both apex + www SAN — www handshake succeeds)
### ⚠️ NOTABLE CHANGE — canonical host flipped from `www` → apex (`blackouttrades.com`)
- Prior runs today (03:23 / 07:14 / 07:21) had **www serve the app directly (200)** and all redirects pointed to `https://www…`. This run: **`https://www.blackouttrades.com/` now 301-redirects to `https://blackouttrades.com/`** (apex). The apex is the live origin (200, Next.js, full headers); www is now a Cloudflare-level redirect host.
- **Not an outage / not a P0** — every www request resolves correctly (301→apex→200) and the availability probe (which follows redirects) saw 12/12 healthy. This is a host-canonicalization config change, harmless to users.
- **Action for the monitor itself:** header/redirect checks that hit `www` with `MaximumRedirection 0` now read the *redirect* response, not the served page — this is what produced the spurious "CSP MISSING" below. The task should probe the **apex** (or follow redirects) for header verification. No app defect.
### Availability: 12/12 routes healthy — **PASS**
- Landing 200 (1377ms), Sign In 200 (227ms), Sign Up 200 (186ms), /api/health 200 (106ms)
- Protected page routes followed (Accept: text/html → 307→/sign-in chain) to 200: /dashboard 200 (278ms), /flows 200 (320ms), /heatmap 200 (231ms), /grid 200 (158ms), /nighthawk 200 (342ms)
- Auth-gated APIs 401 as intended (~88–97ms): /api/market/spx/pulse, /api/market/gex-positioning, /api/market/flows
- **No 5xx. No P0. No slow routes (all <1.4s; landing 1.38s likely cold edge, well under the 3s WARN line).**
### Security Headers: **PASS on served origin (apex)** — CSP "MISSING" on www was a FALSE ALARM (read the redirect, not the page)
- Verified directly against `https://blackouttrades.com/`: **CSP present** (`default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://s.tradingview.com …`), plus HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy — all present.
- WARN (unchanged, low priority): `X-Powered-By: Next.js` leaking on apex → harden with `poweredByHeader: false`. `Server: cloudflare` expected (CF edge).
### Redirects: **PASS** — http→https 301 → https://blackouttrades.com/ ; www→apex 301 ; /pricing 301 → https://blackouttrades.com/pricing (host-normalized at edge first; apex then applies the in-app 307→/#pricing)
### CDN: **PASS** — Cloudflare edge (CF-Ray a12621d90b505b4d-SEA), apex CF-Cache-Status DYNAMIC + X-Railway-Request-Id present, root Cache-Control `private, no-cache, no-store, max-age=0, must-revalidate`.
---

## 2026-06-27 09:22 ET
### TLS: cert expires 2026-09-14 — 79 days remaining — **PASS** (CN=blackouttrades.com, issuer Google Trust Services WE1; handshake valid for both www and apex)
### Availability: 12/12 routes healthy — **PASS**
- Pages 200 (probe hits www, follows www→apex 301 to a 200): Landing 748ms, Sign In 201ms, Sign Up 231ms, /dashboard 224ms, /flows 213ms, /heatmap 236ms, /grid 164ms, /nighthawk 213ms; /api/health 200 (100ms)
- Auth-gated APIs 401 as intended (~96–104ms): /api/market/spx/pulse, /api/market/gex-positioning, /api/market/flows
- **No 5xx. No P0. No slow routes (all <750ms).**
### Security Headers: 6/6 present on rendered page — **PASS** (HSTS max-age + preload, X-Content-Type-Options nosniff, X-Frame-Options SAMEORIGIN, Referrer-Policy strict-origin, CSP default-src 'self', Permissions-Policy camera=())
- Reading note: CSP & friends appear only on the final 200 page, NOT on the www→apex 301 hop — must follow redirects before checking headers (an unfollowed read falsely reports "CSP MISSING").
- WARN (unchanged, low priority): `X-Powered-By: Next.js` leaking → harden with `poweredByHeader: false` in next.config. `Server: cloudflare` expected (CF edge).
### Redirects: **PASS — but canonical host CHANGED since the 07:21 run**
- **CHANGE: canonical host is now the APEX, not www.** `https://www/` → **301 → https://blackouttrades.com/** ; `http://www/` → 301 → https://blackouttrades.com/ (single hop to https+apex); `https://blackouttrades.com/` → 200 (final). Prior runs reported the reverse (apex→www, www canonical, e.g. "http→https 301 → https://www…/"). Both directions are valid SEO choices and every hop is a clean 301 ending at 200 — **not a defect**, but flagging the infra/Cloudflare/DNS canonicalization flip in case it was unintended (verify OG/canonical tags + Clerk allowed origins still match).
- /pricing: apex `307 → /#pricing` (unchanged); www `/pricing 301 → apex /pricing` (→ then 307 → /#pricing).
### CDN: **PASS** — Cloudflare edge (CF-Ray a124c21b98491639-SEA), Railway request ID present, root Cache-Control `private, no-cache, no-store, max-age=0, must-revalidate`. Step-5 "API may be cached" WARN is a known false positive (unauth SPX-pulse 401 carries no Cache-Control header to read).
---

## 2026-06-27 11:22 ET
### TLS: cert expires 2026-09-14 — 79 days remaining — **PASS** (CN=blackouttrades.com, issuer Google Trust Services WE1; handshake valid)
### Availability: 12/12 routes healthy — **PASS**
- Pages 200 (probe hits www, follows www→apex 301 to 200): Landing 600ms, Sign In 170ms, Sign Up 183ms, /dashboard 240ms, /flows 233ms, /heatmap 237ms, /grid 140ms, /nighthawk 249ms; /api/health 200 (105ms)
- Auth-gated APIs 401 as intended (~90–98ms): /api/market/spx/pulse, /api/market/gex-positioning, /api/market/flows
- **No 5xx. No P0. No slow routes (all <650ms).**
### Security Headers: 6/6 present on rendered apex page — **PASS** (HSTS max-age=31536000 +includeSubDomains +preload, X-Content-Type-Options nosniff, X-Frame-Options SAMEORIGIN, Referrer-Policy strict-origin-when-cross-origin, CSP default-src 'self', Permissions-Policy camera=()/microphone=()/geolocation=())
- Reading note (recurring): headers appear only on the final 200 page; the www→apex 301 hop carries none, so an unfollowed read falsely reports "CSP MISSING". Confirmed present by re-probing the apex directly.
- WARN (low priority, expected): `Server: cloudflare` is the CF edge header, not an app info leak.
### Redirects: **PASS** — `https://www/` → 301 → https://blackouttrades.com/ ; `http://www/` → 301 → https://blackouttrades.com/ (canonical = apex, unchanged from 09:22 run); www `/pricing` → 301 → apex /pricing.
### CDN: **PASS** — Cloudflare edge (CF-Ray a12571fdeaecdee1-SEA), Railway request ID present, root Cache-Control `private, no-cache, no-store, max-age=0, must-revalidate`. /api/health carries no Cache-Control (dynamic, not CDN-cached).
---

## 2026-06-27 15:22 ET
### TLS: cert expires 2026-09-14 — 79 days remaining — **PASS** (CN=blackouttrades.com, issuer Google Trust Services WE1; handshake valid)
### Availability: 12/12 routes healthy — **PASS**
- Pages 200 (probe hits www, follows www→apex 301 to 200): Landing 666ms, Sign In 178ms, Sign Up 171ms, /dashboard 228ms, /flows 192ms, /heatmap 293ms, /grid 128ms, /nighthawk 211ms; /api/health 200 (113ms)
- Auth-gated APIs 401 as intended (~83–108ms): /api/market/spx/pulse, /api/market/gex-positioning, /api/market/flows
- **No 5xx. No P0. No slow routes (all <700ms).**
### Security Headers: 6/6 present on rendered apex page — **PASS** (HSTS max-age + preload, X-Content-Type-Options nosniff, X-Frame-Options SAMEORIGIN, Referrer-Policy strict-origin, CSP `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://s.tr…`, Permissions-Policy camera=())
- Reading note (recurring false alarm): the Step-3 check probes `www` with `MaximumRedirection 0`, so it reads the www→apex **301 hop** (which carries no CSP) and falsely reports "CSP MISSING". Re-probing `https://blackouttrades.com/` directly this run confirmed CSP present — no app defect.
- WARN (low priority, unchanged): `X-Powered-By: Next.js` leaking on apex → harden with `poweredByHeader: false` in next.config. `Server: cloudflare` expected (CF edge header, not an app leak).
### Redirects: **PASS** — `http://www/` → 301 → https://blackouttrades.com/ ; www `/pricing` → 301 → https://blackouttrades.com/pricing (canonical = apex, unchanged from prior runs; apex then applies in-app 307→/#pricing).
### CDN: **PASS** — Cloudflare edge (CF-Ray a126d18338dba362-SEA), apex CF-Cache-Status DYNAMIC + X-Railway-Request-Id present, root Cache-Control `private, no-cache, no-store, max-age=0, must-revalidate`. /api/health carries no Cache-Control (dynamic, not CDN-cached).
---

## 2026-06-27 17:22 ET
### TLS: cert expires 2026-09-14 — 79 days remaining — **PASS** (CN=blackouttrades.com, issuer Google Trust Services WE1; handshake valid)
### Availability: 12/12 routes healthy — **PASS**
- Pages 200 (probe hits www, follows www→apex 301 to 200): Landing 594ms, Sign In 176ms, Sign Up 185ms, /dashboard 234ms, /flows 204ms, /heatmap 213ms, /grid 147ms, /nighthawk 337ms; /api/health 200 (85ms)
- Auth-gated APIs 401 as intended (~96–117ms): /api/market/spx/pulse, /api/market/gex-positioning, /api/market/flows
- **No 5xx. No P0. No slow routes (all <600ms).**
### Security Headers: 6/6 present on rendered apex page — **PASS** (HSTS max-age, X-Content-Type-Options nosniff, X-Frame-Options SAMEORIGIN, Referrer-Policy strict-origin, CSP `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://s.tr…`, Permissions-Policy camera=())
- Reading note (recurring false alarm): the Step-3 check probes `www` with `MaximumRedirection 0`, so it reads the www→apex **301 hop** (no CSP) and falsely reports "CSP MISSING". Re-probing `https://blackouttrades.com/` directly this run confirmed CSP present — no app defect.
- WARN (low priority, unchanged): `X-Powered-By: Next.js` leaking on apex → harden with `poweredByHeader: false` in next.config. `Server: cloudflare` expected (CF edge header, not an app leak).
### Redirects: **PASS** — `http://www/` → 301 → https://blackouttrades.com/ ; www `/pricing` → 301 → https://blackouttrades.com/pricing (canonical = apex; apex then applies in-app 307→/#pricing).
### CDN: **PASS** — Cloudflare edge (CF-Ray a12781535871df0d-SEA), apex CF-Cache-Status DYNAMIC + X-Railway-Request-Id present, root Cache-Control `private, no-cache, no-store, max-age=0, must-revalidate`. /api/health carries no Cache-Control (dynamic, not CDN-cached).
---

## 2026-06-27 19:22 ET
### TLS: cert expires 2026-09-14 — 79 days remaining — **PASS** (CN=blackouttrades.com, issuer Google Trust Services WE1; handshake valid)
### Availability: 12/12 routes healthy — **PASS**
- Pages 200 (probe hits www, follows www→apex 301 to 200): Landing 601ms, Sign In 342ms, Sign Up 172ms, /dashboard 219ms, /flows 238ms, /heatmap 249ms, /grid 270ms, /nighthawk 212ms; /api/health 200 (107ms)
- Auth-gated APIs 401 as intended (~99–107ms): /api/market/spx/pulse, /api/market/gex-positioning, /api/market/flows
- **No 5xx. No P0. No slow routes (all <700ms).**
### Security Headers: 6/6 present on rendered apex page — **PASS** (HSTS max-age, X-Content-Type-Options nosniff, X-Frame-Options SAMEORIGIN, Referrer-Policy strict-origin, CSP `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://s.tradingview.com https://*.tr…`, Permissions-Policy camera=())
- Reading note (recurring false alarm): the Step-3 check probes `www` with `MaximumRedirection 0`, so it reads the www→apex **301 hop** (no CSP) and falsely reports "CSP MISSING". Re-probing `https://blackouttrades.com/` directly this run confirmed CSP present — no app defect.
- WARN (low priority, unchanged): `X-Powered-By: Next.js` leaking on apex → harden with `poweredByHeader: false` in next.config. `Server: cloudflare` expected (CF edge header, not an app leak).
### Redirects: **PASS** — `http://www/` → 301 → https://blackouttrades.com/ ; www `/pricing` → 301 → https://blackouttrades.com/pricing (canonical = apex; apex then applies in-app 307→/#pricing).
### CDN: **PASS** — Cloudflare edge (CF-Ray a12831275c447627-SEA), X-Railway-Request-Id present, root Cache-Control `private, no-cache, no-store, max-age=0, must-revalidate`. /api/health carries no Cache-Control (dynamic, not CDN-cached).
---

## 2026-06-28 03:22 ET
### TLS: cert expires 2026-09-14 — 78 days remaining — **PASS** (CN=blackouttrades.com, issuer Google Trust Services WE1; handshake valid)
### Availability: 12/12 routes healthy — **PASS**
- Pages 200 (Accept:text/html, follows redirects): Landing 493ms, Sign In 205ms, Sign Up 197ms, /dashboard 198ms, /flows 231ms, /heatmap 201ms, /grid 131ms, /nighthawk 200ms; /api/health 200 (94ms)
- Auth-gated APIs 401 as intended (~84–99ms): /api/market/spx/pulse, /api/market/gex-positioning, /api/market/flows
- **No 5xx. No P0. No slow routes (all <500ms).**
### Security Headers: 6/6 present on rendered apex page — **PASS** (HSTS, X-Content-Type-Options nosniff, X-Frame-Options SAMEORIGIN, Referrer-Policy strict-origin-when-cross-origin, CSP `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://s.tradingview.com …` (522 chars), Permissions-Policy camera=())
- Reading note (recurring false alarm, confirmed again): Step-3's probe omits the `Accept: text/html` header **and** uses `MaximumRedirection 0`, so it hits Clerk's protect-rewrite path (which strips CSP) and falsely reports "CSP MISSING". Re-probed with `Accept: text/html` → 6/6 present. Same calibration Step 2 already applies — Step 3 should send the Accept header too. No app defect.
- `X-Powered-By` not leaking (poweredByHeader:false still applied). `Server: cloudflare` expected (CF edge header).
### Redirects: **PASS** — `http://www/` → 301 → https://blackouttrades.com/ ; www `/pricing` → 301 → https://blackouttrades.com/pricing (canonical = apex).
### CDN: **PASS** — Cloudflare edge (CF-Ray a12af06a5fd87208-SEA), X-Railway-Request-Id present. **New this run:** landing now served from **edge cache** (CF-Cache-Status HIT, Age ~1900s, `Cache-Control: s-maxage=31536000`) vs the 01:22 entry's origin `private, no-cache` — consistent with the marketing-pages force-static + CF edge-cache design. All security headers (incl. CSP) intact on the cached response. /api/health carries no Cache-Control (dynamic, not CDN-cached).
---

## 2026-06-28 01:22 ET
### TLS: cert expires 2026-09-14 — 79 days remaining — **PASS** (CN=blackouttrades.com, issuer Google Trust Services WE1; handshake valid)
### Availability: 12/12 routes healthy — **PASS**
- Pages 200 (probe hits www, follows www→apex 301 to 200): Landing 732ms, Sign In 248ms, Sign Up 230ms, /dashboard 275ms, /flows 258ms, /heatmap 297ms, /grid 184ms, /nighthawk 257ms; /api/health 200 (115ms)
- Auth-gated APIs 401 as intended (~108–119ms): /api/market/spx/pulse, /api/market/gex-positioning, /api/market/flows
- **No 5xx. No P0. No slow routes (all <750ms).**
### Security Headers: 6/6 present on rendered apex page — **PASS** (HSTS max-age=31536000 includeSubDomains preload, X-Content-Type-Options nosniff, X-Frame-Options SAMEORIGIN, Referrer-Policy strict-origin-when-cross-origin, CSP `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://s.tr…`, Permissions-Policy camera=())
- Reading note (recurring false alarm): the Step-3 check probes `www` with `MaximumRedirection 0`, so it reads the www→apex **301 hop** (no CSP) and falsely reports "CSP MISSING". Re-probing `https://blackouttrades.com/` directly this run confirmed CSP present — no app defect.
- RESOLVED: `X-Powered-By` no longer leaking on apex (prior `poweredByHeader:false` hardening applied; header now empty). `Server: cloudflare` expected (CF edge header, not an app leak).
### Redirects: **PASS** — `http://www/` → 301 → https://blackouttrades.com/ ; www `/pricing` → 301 → https://blackouttrades.com/pricing (canonical = apex; apex then applies in-app 307→/#pricing).
### CDN: **PASS** — Cloudflare edge (CF-Ray a128e1076cd0e2da-SEA), apex CF-Cache-Status DYNAMIC + X-Railway-Request-Id present, root Cache-Control `private, no-cache, no-store, max-age=0, must-revalidate`. /api/health carries no Cache-Control (dynamic, not CDN-cached).
---

## 2026-06-27 23:23 ET
### TLS: cert expires 2026-09-14 — 79 days remaining — **PASS** (CN=blackouttrades.com, issuer Google Trust Services WE1; handshake valid)
### Availability: 12/12 routes healthy — **PASS**
- Pages 200 (probe hits www, follows www→apex 301 to 200): Landing 603ms, Sign In 347ms, Sign Up 195ms, /dashboard 251ms, /flows 251ms, /heatmap 215ms, /grid 146ms, /nighthawk 221ms; /api/health 200 (100ms)
- Auth-gated APIs 401 as intended (~92–110ms): /api/market/spx/pulse, /api/market/gex-positioning, /api/market/flows
- **No 5xx. No P0. No slow routes (all <700ms).**
### Security Headers: 6/6 present on rendered apex page — **PASS** (HSTS max-age=31536000 includeSubDomains preload, X-Content-Type-Options nosniff, X-Frame-Options SAMEORIGIN, Referrer-Policy strict-origin-when-cross-origin, CSP `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://s.tradingview.com …`, Permissions-Policy camera=())
- Reading note (recurring false alarm): the Step-3 check probes `www` with `MaximumRedirection 0`, so it reads the www→apex **301 hop** (Cloudflare edge, no CSP) and falsely reports "CSP MISSING". Re-probed `https://blackouttrades.com/` directly this run → all 6 headers present. No app defect.
- Config-vs-live deltas (both benign, no action): HSTS live `max-age=31536000` (1yr) vs next.config `63072000` (2yr) — Cloudflare is managing/normalizing HSTS at the edge; 1yr+includeSubDomains+preload still satisfies preload requirements. Permissions-Policy live omits `payment=()` that config sets — edge normalization; the three sensitive directives (camera/microphone/geolocation) are all locked.
- `Server: cloudflare` expected (CF edge header, not an app leak). `X-Powered-By` not leaking (poweredByHeader:false confirmed live).
### Redirects: **PASS** — `http://www/` → 301 → https://blackouttrades.com/ ; www `/pricing` → 301 → https://blackouttrades.com/pricing (canonical = apex; apex then applies in-app 307→/#pricing).
### CDN: **PASS** — Cloudflare edge (CF-Ray a12990c49aa2ba01-SEA), X-Railway-Request-Id present, root Cache-Control `private, no-cache, no-store, max-age=0, must-revalidate`. /api/health carries no Cache-Control (dynamic, not CDN-cached).
### Monitor maintenance: prior entry timestamped `2026-06-28 01:22 ET` is clock-skewed ~2h ahead of true ET (harness date + verified TimeZoneInfo EDT conversion both = 2026-06-27 23:23 ET this run). Cosmetic only — no health impact.
---

## 2026-06-28 23:22 ET
### TLS: cert expires 2026-09-14 — 78 days remaining — **PASS** (CN=blackouttrades.com, issuer Google Trust Services WE1; handshake valid)
### Availability: 12/12 routes healthy — **PASS**
- Pages 200 (probe hits www, follows www→apex 301 to 200): Landing 391ms, Sign In 161ms, Sign Up 138ms, /dashboard 184ms, /flows 207ms, /heatmap 193ms, /grid 142ms, /nighthawk 191ms; /api/health 200 (100ms)
- Auth-gated APIs 401 as intended (~80–103ms): /api/market/spx/pulse, /api/market/gex-positioning, /api/market/flows
- **No 5xx. No P0. No slow routes (all <400ms — fastest run in recent history).**
### Security Headers: 6/6 present on rendered apex page — **PASS** (HSTS max-age=31536000, X-Content-Type-Options nosniff, X-Frame-Options SAMEORIGIN, Referrer-Policy strict-origin, CSP default-src present, Permissions-Policy camera=())
- `Server: cloudflare` expected (CF edge header, not an app leak). `X-Powered-By` not leaking.
### Redirects: **PASS** — `http://www/` → 301 → https://blackouttrades.com/ ; www `/pricing` → 301 → https://blackouttrades.com/pricing (canonical = apex).
### CDN: **PASS** — Cloudflare edge (CF-Ray a131cd9318f0ebee-SEA), X-Railway-Request-Id present, root Cache-Control `s-maxage=31536000` (static marketing page, Age 1160s = CDN-served as intended). /api/health carries no Cache-Control (dynamic, not CDN-cached).
---

## 2026-06-29 01:21 ET
### TLS: cert expires 2026-09-14 - 78 days remaining - PASS
### Availability: 9/9 page+health routes 200 OK | 3 APIs 401 (auth-gated, expected) | Failed: none | Slow: none
### Security Headers: 6/6 present (HSTS, X-CTO, XFO, Referrer-Policy, CSP, Permissions-Policy) | Missing: none | Note: Server=cloudflare (CF edge, benign)
### Redirects: HTTP->HTTPS 301 OK | www->apex 301 OK
### CDN: Cloudflare (CF-Ray a1327d51...-SEA) + Railway (X-Railway-Request-Id present); landing Age=18s cached
---

## 2026-06-29 03:22 ET
### TLS: cert expires 2026-09-14 - 77 days remaining - PASS
### Availability: 12/12 routes OK | Failed: none (APIs 401 = expected unauth) | Slow: none (max 753ms Landing)
### Security Headers: 6/6 present | Missing: none | Note: Server=cloudflare is CF edge identity (benign, not origin leak)
### Redirects: HTTP->HTTPS 301 OK | /pricing 301->apex OK
### CDN: Cloudflare (CF-Ray a1332d23...-SEA) + Railway (X-Railway-Request-Id present) healthy
---
## 2026-06-29 09:22 ET
### TLS: cert expires 2026-09-14 — 77 days remaining — PASS
### Availability: 12/12 routes OK | Failed: none | Slow: none (max 945ms Night Hawk)
### Security Headers: 6/6 present | Missing: none (Server:cloudflare is CF edge header, not app leak)
### Redirects: HTTP→HTTPS 301→apex OK | /pricing 301→apex OK
### CDN: Cloudflare (CF-Ray SEA) + Railway edge present; landing s-maxage=31536000 (Age ~94m, by-design marketing cache); auth APIs 401 no-cache
---

## 2026-06-29 15:23 ET
### TLS: cert expires 2026-09-14 — 77 days remaining — PASS (Google Trust Services WE1)
### Availability: 12/12 routes OK | Failed: none (3 APIs 401 = expected unauth) | Slow: none (max 1007ms Landing)
### Security Headers: 6/6 present (HSTS, X-CTO, XFO, Referrer-Policy, CSP, Permissions-Policy) | Missing: none | Note: Server=cloudflare is CF edge identity (benign, not origin leak)
### Redirects: HTTP→HTTPS 301→apex OK | www/pricing 301→apex OK
### CDN: Cloudflare (CF-Ray a1374d25...-SEA) + Railway (X-Railway-Request-Id present); landing s-maxage=31536000 Age=118s (by-design marketing cache); auth APIs 401 no-cache
---

## 2026-06-29 17:26 ET
### TLS: cert expires 2026-09-14 -- 77 days remaining -- PASS (Google Trust Services WE1, CN=blackouttrades.com)
### Availability: 12/12 reachable, 0 failed (3 APIs 401 = expected unauth, /api/health 200 in 383ms) | Slow (>3s): Landing 41446ms->12871ms re-test, Sign In 4532ms, Sign Up 9363ms, SPX Desk 10156ms, HELIX 5772ms, Heatmaps 8052ms, Grid 20816ms, Night Hawk 29604ms
### WARN: PAGE/SSR routes degraded vs today's 09:22 & 15:23 baselines (both <1s). API routes stayed fast (health 383ms; gex/pulse/flows 251-1037ms), so origin is up and edge/network healthy. Pattern (cached landing + light /api/health fast, SSR page renders 3-41s, Landing warming 41s->12.8s) points to an SSR cold-start, most likely a Railway deploy/restart in the last ~2h. NOT P0 (no 5xx). Recommend re-check next cycle; if page latency persists when no deploy is active, investigate SSR/middleware (Clerk redirect chain) latency.
### Security Headers: 6/6 present (HSTS, X-Content-Type-Options, X-Frame-Options SAMEORIGIN, Referrer-Policy, CSP default-src, Permissions-Policy camera=()) | Missing: none | Server=cloudflare is CF edge identity (benign, not origin/app-stack leak)
### Redirects: HTTP->HTTPS 301->apex OK | www/pricing 301->apex/pricing OK
### CDN: Cloudflare (CF-Ray a138020d...-SEA) + Railway (X-Railway-Request-Id present); landing Cache-Control s-maxage=31536000 Age=1459s (by-design marketing edge cache); auth APIs no-cache 401
---

## 2026-06-30 12:05 AM ET
### TLS: cert expires 2026-09-14 -- 77 days remaining -- PASS (Google Trust Services WE1, CN=blackouttrades.com)
### Availability: 12/12 reachable, 0 failed, 0 5xx (3 APIs 401 = expected unauth). Apex landing served by curl in 0.33s/119KB; warm page routes /api/health 652ms, /flows 386ms, /heatmap 703ms, /dashboard 661ms (all <1s).
### NOTE (not WARN): First-pass Invoke-WebRequest timings were inflated (Landing 14.9-69s, HELIX 22s, Health 18s) but were CLIENT-SIDE artifacts -- cold TLS handshake to the www redirect host (curl measured connect=2.0s, tls=3.4s on www; apex direct = 0.33s) plus intermittent IWR stalls (one apex IWR call hung past 2min while curl fetched it in 0.33s same moment). Warm re-probes were all sub-second, confirming origin + edge healthy. Unlike the 17:26 ET cycle, page routes did NOT stay slow on re-test -- no SSR cold-start this cycle.
### Security Headers: 6/6 present (HSTS max-age=31536000 incl preload, X-Content-Type-Options nosniff, X-Frame-Options SAMEORIGIN, Referrer-Policy strict-origin-when-cross-origin, CSP default-src 'self', Permissions-Policy camera=()) | Missing: none | No X-Powered-By/stack leak; Server=cloudflare is CF edge identity (benign)
### Redirects: HTTP->HTTPS 301->apex OK | www->apex 301 OK | www/pricing 301->apex/pricing OK
### CDN: Cloudflare (CF-Ray a138e805...-SEA) edge HIT on landing (Cache-Control s-maxage=31536000, Age=1153s, by-design marketing cache); dynamic /api/market/spx/pulse CF-Cache-Status=DYNAMIC no-cache 401 (correct -- not edge-cached)
---

## 2026-06-29 09:42 PM ET
### TLS: cert expires 2026-09-14 -- 77 days remaining -- PASS (Google Trust Services WE1, CN=blackouttrades.com)
### Availability: 12/12 reachable, 0 failed, 0 5xx (3 APIs 401 = expected unauth). All page routes 200. Origin healthy: apex landing 200 in 1.3-1.7s/119KB (curl warm), www page routes 301->apex fast (dashboard 1.2s, flows 3.4s incl cold TLS).
### NOTE (not WARN): First-pass Invoke-WebRequest page timings were inflated (Landing 30s, HELIX 24s, Night Hawk 11s, Heatmaps 6.6s, SPX Desk 5.3s, Sign In 4.5s) but match the recurring CLIENT-SIDE artifact -- cold TLS handshake to the www redirect host + intermittent IWR stalls. APIs stayed fast in the SAME run (GEX 86ms, health 685ms, flows 1224ms, pulse 1021ms), so origin + edge are healthy; if pages were truly cold-starting the light /api/health would have been slow too. Warm curl re-probes confirmed apex 200 in 1.3-1.7s and all page redirects sub-3.5s. NOT a P0 (no 5xx, no hard failures). Same benign pattern as the 2026-06-30 12:05 AM cycle, NOT the 06-29 17:26 ET SSR cold-start (page routes did NOT stay slow on re-test this cycle).
### Security Headers: 6/6 present (HSTS max-age=31536000 incl preload, X-Content-Type-Options nosniff, X-Frame-Options SAMEORIGIN, Referrer-Policy strict-origin-when-cross-origin, CSP default-src 'self', Permissions-Policy camera=()) | Missing: none | No X-Powered-By/stack leak; Server=cloudflare is CF edge identity (benign)
### Redirects: HTTP->HTTPS 301->apex OK | www/pricing 301->apex/pricing OK | www page routes 301->apex OK
### CDN: Cloudflare (CF-Ray a1397649...-SEA) + Railway (X-Railway-Request-Id present); landing s-maxage=31536000 Age=1626s (by-design marketing edge cache); auth APIs no-cache 401
---

## 2026-06-29 11:26 PM ET
### TLS: cert expires 2026-09-14 -- 77 days remaining -- PASS (Google Trust Services WE1, CN=blackouttrades.com)
### Availability: 12/12 reachable, 0 failed, 0 5xx (3 APIs 401 = expected unauth). All page routes 200. In-run timings mostly fast: Sign In 217ms, Sign Up 358ms, SPX Desk 298ms, HELIX 271ms, Grid 844ms, Night Hawk 703ms, /api/health 124ms, GEX 186ms (401), pulse 114ms (401), flows 1102ms (401).
### WARN (route-specific, not P0): /heatmap slow and STAYED slow on warm re-probe -- 21927ms first pass, 7621ms on retry (both >3s threshold). Unlike the usual client-side IWR artifact, this did NOT recover sub-second on re-test while every other page route in the SAME run was <1s (dashboard 298ms, flows 271ms, grid 844ms) and light /api/health was 124ms -- so origin + edge are healthy and the slowness is isolated to the Heatmaps page SSR (heavy auth-gated render / cold serverless render), matching the 06-29 17:26 ET SSR cold-start signature rather than the cold-TLS-handshake pattern. Landing first pass 4454ms but recovered to 1102ms on retry (transient cold start, benign). No 5xx, no hard failures -> WARN not P0.
### Security Headers: 6/6 present (HSTS max-age= incl, X-Content-Type-Options nosniff, X-Frame-Options SAMEORIGIN, Referrer-Policy strict-origin, CSP default-src, Permissions-Policy camera=()) | Missing: none | No X-Powered-By/stack leak; Server=cloudflare is CF edge identity (benign)
### Redirects: HTTP www->HTTPS 301->https://blackouttrades.com/ apex OK | www/pricing 301->apex/pricing OK
### CDN: Cloudflare (CF-Ray a13a1025...-SEA) + Railway (X-Railway-Request-Id present); landing Cache-Control s-maxage=31536000 (by-design marketing edge cache); auth API spx/pulse no-cache 401 (correct -- not edge-cached)
---

## 2026-06-30 01:22 ET
### TLS: cert expires 2026-09-14 — 77 days remaining — PASS
### Availability: 9/9 public routes 200 OK (3 market APIs 401 = auth-gated, expected). No 5xx, no slow routes (max 769ms Landing). PASS
### Security Headers: 6/6 present (HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, CSP, Permissions-Policy). WARN: Server=cloudflare (generic CDN id, benign)
### Redirects: HTTP→HTTPS 301→apex OK; www/pricing 301→apex OK
### CDN: Cloudflare edge healthy (CF-Ray a13abab9...-SEA), Railway request-id present, Landing s-maxage=31536000 (force-static marketing, by design). Dynamic spx/pulse 401 unauth so CDN-cache check N/A.
---

## 2026-06-30 03:22 ET
### TLS: cert expires 2026-09-14 — 76 days remaining — PASS (Google Trust Services WE1, CN=blackouttrades.com)
### Availability: 12/12 reachable, 0 failed, 0 5xx. 9 page routes 200 OK; 3 market APIs 401 (auth-gated, expected unauth). All fast: Landing 727ms, Sign In 396ms, Sign Up 189ms, SPX Desk 217ms, HELIX 224ms, Heatmaps 225ms, Grid 381ms, Night Hawk 208ms, /api/health 110ms, pulse 93ms (401), GEX 90ms (401), flows 98ms (401). No slow routes (>3s). PASS — Heatmaps recovered to 225ms vs prior runs' SSR cold-start signature.
### Security Headers: 6/6 present (HSTS max-age=31536000 incl preload, X-Content-Type-Options nosniff, X-Frame-Options SAMEORIGIN, Referrer-Policy strict-origin-when-cross-origin, CSP default-src, Permissions-Policy camera=()) | Missing: none | No X-Powered-By/stack leak; Server=cloudflare is CF edge identity (benign)
### Redirects: HTTP www→HTTPS 301→https://blackouttrades.com/ apex OK | www/pricing 301→apex/pricing OK
### CDN: Cloudflare (CF-Ray a13b6aeb...-SEA) + Railway (X-Railway-Request-Id present); landing Cache-Control s-maxage=31536000 Age=19s (by-design marketing edge cache); auth API spx/pulse 401 unauth (no body cached — CDN-cache check N/A, benign)
---

## 2026-06-30 05:22 ET
### TLS: cert expires 2026-09-14 — 76 days remaining — PASS (Google Trust Services WE1, CN=blackouttrades.com)
### Availability: 12/12 reachable, 0 failed, 0 5xx. 9 page routes 200 OK; 3 market APIs 401 (auth-gated, expected unauth). All fast: Landing 616ms, Sign In 318ms, Sign Up 330ms, SPX Desk 228ms, HELIX 238ms, Heatmaps 434ms, Grid 166ms, Night Hawk 251ms, /api/health 107ms, pulse 96ms (401), GEX 94ms (401), flows 88ms (401). No slow routes (>3s). PASS
### Security Headers: 6/6 present (HSTS max-age incl, X-Content-Type-Options nosniff, X-Frame-Options SAMEORIGIN, Referrer-Policy strict-origin, CSP default-src, Permissions-Policy camera=()) | Missing: none | No X-Powered-By/stack leak; Server=cloudflare is CF edge identity (benign)
### Redirects: HTTP www→HTTPS 301→https://blackouttrades.com/ apex OK | www/pricing 301→apex/pricing OK
### CDN: Cloudflare (CF-Ray a13c1ac3...-SEA) + Railway (X-Railway-Request-Id present); landing Cache-Control s-maxage=31536000 Age=3872s (by-design marketing edge cache); auth API health no explicit Cache-Control (200, dynamic — N/A for unauth)
---
