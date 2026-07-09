# Cloudflare Configuration — blackouttrades.com

> Configured 2026-06-27 via API through browser session. Reference this before touching CF settings.

## Account
- **Zone:** blackouttrades.com
- **Plan:** Free (upgrade to Pro for rate limiting + Bot Fight Mode)
- **Account email:** Coreentryadmin@gmail.com

---

## DNS Records (do not change proxy status)

| Name | Type | Content | Proxied | Notes |
|---|---|---|---|---|
| blackouttrades.com | CNAME | `blackout-production-alb-*.elb.amazonaws.com` | ✅ YES | Main app → **ECS prod ALB** (cutover 2026-07) |
| www.blackouttrades.com | CNAME | same ALB (or apex) | ✅ YES | www → apex via redirect rule |
| clk._domainkey | CNAME | dkim1.tzneys6rxyan.clerk.services | ❌ NO | Clerk DKIM — must stay DNS-only |
| clk2._domainkey | CNAME | dkim2.tzneys6rxyan.clerk.services | ❌ NO | Clerk DKIM — must stay DNS-only |
| mail (Clerk) | CNAME | mail.tzneys6rxyan.clerk.services | ❌ NO | Clerk mail — must stay DNS-only |
| blackouttrades.com | MX | (Zoho) | ❌ NO | Email — must stay DNS-only |
| blackouttrades.com | TXT | zoho-verification=... | ❌ NO | Zoho domain verify |
| _railway-verify | TXT | railway-verify=... | ❌ NO | Railway verify |

**CRITICAL:** Clerk DNS records MUST remain DNS-only (grey cloud). Proxying them breaks auth.

---

## Security Settings

| Setting | Value | Notes |
|---|---|---|
| SSL mode | `full` | Full encryption origin↔CF↔user |
| Always HTTPS | `on` | HTTP → HTTPS redirect |
| HSTS | enabled, max_age=31536000, includeSubdomains, preload | 1 year, full HSTS preload |
| TLS minimum | `1.2` | Blocks TLS 1.0/1.1 |
| TLS 1.3 | `zrt` (on + 0-RTT) | Fastest handshake |
| 0-RTT resumption | `on` | Reduces repeat-visit latency |
| DNSSEC | `active` (propagating ~24h from setup) | DNS tampering protection |
| Browser integrity check | `on` | Blocks known bad bots |
| Security level | `medium` | Challenges suspicious IPs |
| Hotlink protection | `on` | Prevents asset embedding by other sites |
| Email obfuscation | `on` | Hides emails from scrapers |
| Server-side excludes | `on` | |
| Post-quantum key exchange | `on` | Future-proof encryption |

---

## Security Response Headers (applied to ALL responses via Transform Rules)

| Header | Value |
|---|---|
| X-Content-Type-Options | nosniff |
| X-Frame-Options | SAMEORIGIN |
| X-XSS-Protection | 1; mode=block |
| Referrer-Policy | strict-origin-when-cross-origin |
| Permissions-Policy | camera=(), microphone=(), geolocation=() |

---

## Performance Settings

| Setting | Value | Notes |
|---|---|---|
| Brotli compression | `on` | Better than gzip, supported by all modern browsers |
| HTTP/2 | `on` | Multiplexed requests |
| HTTP/3 (QUIC) | `on` | Fastest protocol, especially on mobile |
| Early Hints (103) | `on` | Browser starts loading assets before full response |
| Browser cache TTL | `31536000` (1 year) | Static assets cached in browser for 1 year |
| Always Online | `on` | Serves cached version if Railway is down |
| Challenge TTL | `3600` (1 hour) | How long a challenged IP stays trusted |
| ECH (Encrypted Client Hello) | `on` | Hides SNI from network observers |
| Opportunistic encryption | `on` | |
| Opportunistic onion | `on` | Tor users get .onion routing |
| Automatic HTTPS rewrites | `on` | Fixes mixed-content http:// links in HTML |

---

## Audit snapshot (2026-07-09)

| Check | Status | Notes |
|-------|--------|-------|
| Zone active | ✅ | Free plan |
| Origin | ✅ | `cdn-cgi/trace` → AWS IP (ECS ALB), not Railway |
| Marketing CSS | ✅ | All 3 `/_next/static/css/*.css` return **200** |
| API bypass | ✅ | `/api/health` → `cf-cache-status: DYNAMIC` |
| www redirect | ✅ | 301 → apex |
| Security headers | ✅ | Transform rules (CSP, HSTS, X-Frame-Options, etc.) |
| Static 404 caching | ❌ **FIX NEEDED** | Repeat 404 on `/_next/static/*.css` → `cf-cache-status: HIT` |
| `/embed/*` framing | ⚠️ | Transform rule sets `X-Frame-Options: SAMEORIGIN` on all paths — breaks cross-origin embeds |
| `CF_API_TOKEN` in CI/ops | ⚠️ | Current token is **purge-only** — cannot read/edit rulesets via API |
| DNS records (API) | ⚠️ | Needs token with **Zone.DNS Read** to verify CNAME targets in dashboard |

---

## Cache Rules (applied in order — first match wins)

| Priority | Match | Action | Edge TTL |
|---|---|---|---|
| 1 | `/_next/static/*` (+ extension regex) | Cache | 1 year **for HTTP 200 only**; 404/4xx/5xx **no-cache** |
| 2 | `/api/market/gex-positioning` | Cache | 60s |
| 3 | `/api/market/news` | Cache | 120s |
| 4 | `/api/market/regime` | Cache | 30s |
| 5 | `/api/*` (everything else) | Bypass | — |

**Why these routes:** GEX, news, regime are public market data — identical for all users.
All auth-gated or user-specific routes bypass cache entirely.

---

## Redirect Rules

| Rule | Action |
|---|---|
| `www.blackouttrades.com/*` → `blackouttrades.com/*` | 301 permanent redirect |

Canonical URL is the apex domain (no www).

---

## Active Rulesets (Cloudflare-managed)

| Ruleset | Phase | Notes |
|---|---|---|
| Cloudflare Normalization Ruleset | http_request_sanitize | Normalizes requests to prevent bypass tricks |
| Cloudflare Managed Free Ruleset | http_request_firewall_managed | Free WAF — blocks OWASP top 10 patterns |
| DDoS L7 ruleset | ddos_l7 | Automatic DDoS mitigation |
| Cache rules (ours) | http_request_cache_settings | Configured above |
| Redirect rules (ours) | http_request_dynamic_redirect | www → apex |
| Security headers (ours) | http_response_headers_transform | Security headers on all responses |

---

## App Compatibility (DO NOT CHANGE)

| Setting | Value | Reason |
|---|---|---|
| WebSockets | `on` | Required for SSE streams + WS connections |
| Rocket Loader | `off` | **Must stay off** — breaks Next.js RSC/async JS |
| Response buffering | `off` | **Must stay off** — breaks SSE streaming |
| Railway CDN | `off` | **Must stay off** — conflicts with Cloudflare (double CDN) |

---

## Requires Pro Plan ($20/mo) — Not Yet Configured

| Feature | Why It Matters |
|---|---|
| Rate limiting on `/sign-in` (10 req/min) | Brute force protection on auth |
| Rate limiting on `/api/*` (300 req/min) | API abuse prevention |
| Bot Fight Mode | Blocks credential stuffing bots |
| Image optimization (Polish + WebP) | Automatic image compression at edge |

To upgrade: dash.cloudflare.com → blackouttrades.com → Overview → Upgrade Plan.
After upgrading, add rate limit rules via: Security → WAF → Rate Limiting Rules.

---

## DNSSEC DS Records (add at domain registrar after propagation)

After DNSSEC finishes propagating (~24h), go to:
1. dash.cloudflare.com → blackouttrades.com → DNS → DNSSEC
2. Copy the DS record shown
3. Add it at your domain registrar's DNS settings

---

## Maintenance Notes

- **Static cache rule:** Rule 1 must include **status-code TTL** (404 → 0). Verified bug 2026-07-09: without it, edge caches 404 CSS during deploy. Run `npm run cf:audit-apply` to audit; `--apply --purge` to patch + purge.
- **CF API token:** `CF_API_TOKEN` in prod must include **Zone.Cache Rules Edit** (not purge-only). Purge-only tokens cannot read/update rulesets.
- **On every ECS/Railway deploy:** `cf-purge-on-deploy.ts` purges when `CF_API_TOKEN` + deploy id present; also run full purge after cache-rule changes.
- **If you change an API route from public → auth-gated:** Add it to the cache bypass rule immediately
- **Never proxy Clerk DNS records** — breaks sign-in
- **Never enable Railway CDN** while Cloudflare proxy is active
- **If you upgrade to Vercel:** Update the Railway CNAME records to point to Vercel deployment URL instead
