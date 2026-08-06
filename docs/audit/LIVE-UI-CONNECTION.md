# LIVE-UI-CONNECTION — how to actually see the live UI from the agent sandbox

**Read this before saying UI or pixel validation is impossible.** It is not. The tool that
does it — `proxy-browser.cjs` — has been committed at the repo root since #1188, but the doc
explaining it was only ever written in PR #947, which was **closed unmerged** (draft, 314
files, conflicted). So the capability shipped and the knowledge did not, and CLAUDE.md's
"Access reality" §2 described a plain-Playwright approach that does **not** work here. This
file closes that gap.

---

## The one thing to understand

Chromium in this sandbox **cannot reach the network at all** — not directly, and not through
the agent proxy. Every outbound request dies with `net::ERR_CONNECTION_RESET`, and the proxy's
own `recentRelayFailures` stays **empty**, meaning Chromium's traffic never even arrives at the
proxy to be denied. Node's `fetch`/`curl` through the same proxy return 200 from the same URL
in the same shell.

The fix is not a proxy flag. It is to **take the network away from Chromium entirely**:
Playwright's `context.route('**/*')` intercepts every request before Chromium opens a socket,
and each one is fulfilled from Node via a manual `CONNECT` + `tls.connect()` tunnel through the
agent proxy. Chromium never makes an HTTPS connection — it only renders bytes handed to it.

That is exactly what `proxy-browser.cjs` implements.

---

## Verified working (2026-08-06)

```
node proxy-browser.cjs "https://blackouttrades.com/<path>" out.png \
  --cookie "$CK" --viewport 430x932 --wait 9000
→ https://blackouttrades.com/<path>
DOM loaded
Routed: 25 ok, 0 fail
Saved: out.png
```

`Routed: N ok, 0 fail` is the health line — every browser request went through the tunnel.

## Verified NOT working — do not retry these

| Approach | Result |
|---|---|
| `chromium.launch({ proxy: { server: HTTPS_PROXY } })` | `ERR_CONNECTION_RESET` |
| `--proxy-server=$HTTPS_PROXY` as a Chromium arg | `ERR_CONNECTION_RESET` |
| No proxy at all (direct) | `ERR_CONNECTION_RESET` — *identical*, which is the tell |
| Any harness that calls `page.goto()` without `context.route` interception | same |

All three fail identically, and the proxy logs nothing. If you find yourself concluding "the
site is unreachable," check whether Chromium can load a **local** server first — it can (200
OK), which proves the browser is fine and only its egress is blocked.

**Consequence:** the committed Playwright harnesses that call `page.goto()` directly —
`validate-prod-ui-full.mjs`, `validate-prod-admin-ui.mjs`, `ios-native-ui-e2e.mjs`,
`spx-dashboard-e2e-audit.mjs` — fail at the first navigation in this sandbox. They are not
broken; they predate this egress restriction. Route them through the interception shim, or use
`proxy-browser.cjs` directly, before reporting them as failures.

---

## Recipe: authenticated screenshot of any page

```bash
# 1. Mint a temp admin+premium Clerk session (deleted by releaseAuditClerkSession)
cat > /tmp/mint.mjs <<'EOF'
import { mintClerkPremiumSession } from "/home/user/blackout-web/scripts/audit/lib/prod-clerk-session.mjs";
const s = await mintClerkPremiumSession({ appUrl: "https://blackouttrades.com" });
if (s.skip) { console.error("SKIP", s.reason ?? ""); process.exit(1); }
console.log("COOKIE::" + s.cookieHeader);
EOF
CK=$(node --import tsx /tmp/mint.mjs | grep '^COOKIE::' | sed 's/^COOKIE:://')

# 2. Shoot it. Run from the REPO ROOT — proxy-browser.cjs resolves `playwright`
#    from ./node_modules, so it throws ERR_MODULE_NOT_FOUND from anywhere else.
node proxy-browser.cjs "https://blackouttrades.com/nighthawk" shot.png \
  --cookie "$CK" --viewport 430x932 --wait 9000
```

Flags: `--cookie "k=v; k2=v2"` · `--viewport WxH` (default `430x932`, iPhone) · `--wait ms`
(default 5000 — raise it for SWR/SSE panels that hydrate late) · `--full` (full-page).

The context is fixed to an iPhone UA with `BlackOutiOSApp/1.0`, `deviceScaleFactor: 3`,
`isMobile: true`. For a desktop shot, pass `--viewport 1440x900` — note the UA stays mobile,
so a UA-gated shell will still render its mobile variant.

**Session JWTs are short-lived (~60s `exp`).** Mint immediately before shooting; if a run is
slow, re-mint rather than reusing. Batch pages in one process if you need many.

---

## Real route names (a 404 is usually a wrong path, not a broken page)

The desk lives under a route group, so the URL has **no** group segment. There is no
`/night-hawk` and no `/swings`:

| Product | Path |
|---|---|
| Night Hawk 0DTE | `/nighthawk` |
| Terminal | `/terminal` |
| Vector | `/vector` |
| Helix (flows) | `/flows` |
| Thermal (heatmap) | `/heatmap` |
| Dashboard | `/dashboard` |
| Track record | `/track-record` |
| Admin | `/admin`, `/admin/track-record`, `/admin/users` |

Enumerate current truth with:
`find src/app -name page.tsx | sed 's#src/app/##; s#/page.tsx##' | sed 's#([a-z-]*)/##g'`

An unstyled Times-New-Roman render usually means you are looking at the **404 page**, not a CSS
failure — check the heading before debugging asset loading.

---

## Don't shoot during a rollout

Mid-deploy, requests land on draining tasks and you get `Routed: 2 ok, 0 fail` with a nav
reset — a *transport* failure that looks like a broken page. Confirm the service is settled
first:

```bash
env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY aws ecs describe-services \
  --cluster blackout-production-cluster --services blackout-production-web \
  --region us-east-1 \
  --query 'services[0].[deployments[?status==`PRIMARY`].rolloutState|[0],runningCount,desiredCount]' \
  --output text
```

Wait for `COMPLETED` with `running == desired`, then shoot.

---

## When pixels are not the point

If you only need to know whether a field, value or component reached the client, the
authenticated **HTTP** path (CLAUDE.md access-reality §1) is faster and more precise than a
screenshot — `scripts/audit/lib/audit-auth-fetch.mjs` (`fetchAuditJson`, cron-bearer first with
a Clerk fallback) gives you the real served payload or HTML. Use pixels for layout, overlap,
clipping and "does it actually look right"; use HTTP for "is the number correct".
