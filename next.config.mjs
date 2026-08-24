/** @type {import('next').NextConfig} */

// Base CSP for the whole app. `frame-ancestors 'self'` (plus X-Frame-Options
// SAMEORIGIN below) denies cross-origin framing everywhere — which is correct
// for every route EXCEPT the public /embed/* social-proof cards, which are
// handed to users as an <iframe> snippet to drop on their own sites (see
// /track-record). Those get a scoped override below.
const baseCsp =
  "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://s.tradingview.com https://*.tradingview.com https://clerk.blackouttrades.com https://*.clerk.accounts.dev https://challenges.cloudflare.com https://static.cloudflareinsights.com https://www.googletagmanager.com https://www.google-analytics.com https://static.ads-twitter.com https://analytics.twitter.com; worker-src 'self' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; connect-src 'self' https: wss:; frame-src 'self' https://s.tradingview.com https://*.tradingview.com https://challenges.cloudflare.com; frame-ancestors 'self'";

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    // `microphone=(self)` — OUR origin only. An empty allowlist `microphone=()` disables the
    // microphone for EVERY origin including our own, which is what shipped and what broke Largo's
    // voice input on desktop.
    //
    // WHY IT LOOKED LIKE IT WORKED ON MOBILE. Chrome on desktop enforces Permissions-Policy for
    // the Web Speech API, so start() failed before a prompt could appear and the control looked
    // dead. Safari on iOS routes SpeechRecognition through system dictation and does not gate it
    // on the same policy, so the identical build worked on a phone. A header, not the code, was
    // the difference — which is why no amount of reading the component would have found it.
    //
    // Everything else stays locked shut: camera, geolocation and payment remain fully disabled,
    // and `self` grants nothing to embedded third-party frames.
    value: "camera=(), microphone=(self), geolocation=(), payment=()",
  },
  {
    key: "Content-Security-Policy",
    value: baseCsp,
  },
];

// Scoped header set for /embed/* ONLY. These routes are public, unauthenticated,
// read-only social-proof cards meant to be framed cross-origin on arbitrary
// customer sites (the /track-record page hands users the <iframe> snippet), so
// the global frame-deny would otherwise block their entire purpose. We:
//   - OMIT X-Frame-Options entirely (it's a single-value legacy header that can't
//     express an allowlist; leaving it set to SAMEORIGIN would override CSP in
//     older browsers and keep blocking the embed).
//   - Relax CSP frame-ancestors to `*` so any host may frame these cards. There is
//     no clickjacking surface here: no auth, no interactive/state-changing UI, no
//     sensitive data — only an aggregate stat card.
// All other security headers are kept identical to the rest of the app, and this
// override is scoped to /embed/* so framing for every other route stays locked down.
const embedSecurityHeaders = securityHeaders
  .filter((h) => h.key !== "X-Frame-Options")
  .map((h) =>
    h.key === "Content-Security-Policy"
      ? { ...h, value: baseCsp.replace("frame-ancestors 'self'", "frame-ancestors *") }
      : h,
  )
  // Embeds keep the microphone FULLY disabled. The app-wide policy grants it to `self` for
  // Largo's voice input, but these routes are public, unauthenticated, and deliberately framed
  // on arbitrary third-party sites (`frame-ancestors *`). Nothing here needs a microphone, so
  // least privilege applies — and the grant must not ride along by inheritance if this page
  // ever grows client code.
  .map((h) =>
    h.key === "Permissions-Policy"
      ? { ...h, value: h.value.replace("microphone=(self)", "microphone=()") }
      : h,
  );

const remotePatterns = [
  { protocol: "https", hostname: "images.unsplash.com" },
];

import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// P3: os.cpus() can return an empty array (and is unreliable in constrained
// containers / cgroup-limited environments), so reading .length directly is
// fragile. Guard with optional chaining + a sane fallback of 1 core before the
// Math.max(1, ...-1) clamp so we never produce NaN or a value < 1.
const cpuCount = os.cpus()?.length || 1;

// Auth-dependent document routes must never be edge-cached: a cached HTML response
// would freeze one user's signed-in/signed-out chrome and serve it to everyone else
// (see the Cloudflare edge-cache incident in CLAUDE.md, fixed 2026-07-22 by adding a
// __session cookie bypass to the dashboard-managed cache rule). Vary: Cookie tells any
// downstream cache that a different cookie means a different response.
const authDocumentEdgeBypass = [
  { key: "CDN-Cache-Control", value: "no-store" },
  { key: "Cloudflare-CDN-Cache-Control", value: "no-store" },
  { key: "Cache-Control", value: "private, no-cache, no-store, must-revalidate, max-age=0" },
  { key: "Vary", value: "Cookie" },
];

const nextConfig = {
  poweredByHeader: false,
  // ECS/Fargate Docker image — emits .next/standalone for multi-stage Dockerfile.
  output: "standalone",
  // Force all metadata (<title>, meta, OG, canonical, JSON-LD) into <head> for
  // crawlers that don't execute JS. Without this, Next 15.2+ streams metadata
  // into <body> for non-bot UAs, but Googlebot, GPTBot, PerplexityBot and
  // ClaudeBot all receive an empty <head>. This list extends Next's built-in
  // htmlLimitedBots with AI crawlers relevant to a finance/trading platform.
  htmlLimitedBots: [
    "Googlebot",
    "Bingbot",
    "Yandex",
    "DuckDuckBot",
    "Baiduspider",
    "Twitterbot",
    "facebookexternalhit",
    "LinkedInBot",
    "Slackbot",
    "WhatsApp",
    "Discordbot",
    "GPTBot",
    "ChatGPT-User",
    "ClaudeBot",
    "PerplexityBot",
    "Applebot",
    "Google-Extended",
    "CCBot",
    "anthropic-ai",
    "Bytespider",
    "cohere-ai",
  ],
  experimental: {
    cpus: Math.max(1, cpuCount - 1),
  },
  // instrumentation.ts register() runs at server startup automatically in Next 15
  // (the former experimental.instrumentationHook is now the default — flag removed).
  // ESLint runs during builds (ignoreDuringBuilds: false). All current findings are
  // Warning-level so they do not block deploys. An Error-level finding will fail the
  // CI/Docker build — the desired gate: catch regressions at build time, not in prod.
  eslint: { ignoreDuringBuilds: false },
  async redirects() {
    return [
      { source: "/learn/helix", destination: "/learn/helix-flows", permanent: true },
      { source: "/helix", destination: "/flows", permanent: true },
      // Legacy browsers and crawlers request /favicon.ico by convention; without this they get a
      // 28KB HTML 404 (see docs/audit/SEO-BASELINE-2026-08-21 P3-1). icon-192.png is the committed
      // manifest icon and is already edge-cacheable.
      { source: "/favicon.ico", destination: "/icon-192.png", permanent: true },
    ];
  },
  async headers() {
    // These two rules are MUTUALLY EXCLUSIVE by construction. Next.js does not
    // dedupe headers across matching `source` entries — if both a catch-all and an
    // /embed rule matched, the response would carry duplicated X-Frame-Options /
    // CSP values (undefined precedence). To avoid that, the catch-all uses a
    // negative-lookahead so it matches every path EXCEPT /embed/*, and the embed
    // rule owns /embed/* exclusively. Net effect: framing stays denied app-wide and
    // is relaxed only for the public embed cards.
    return [
      {
        source: "/",
        headers: [...securityHeaders, ...authDocumentEdgeBypass],
      },
      {
        source: "/upgrade",
        headers: [...securityHeaders, ...authDocumentEdgeBypass],
      },
      {
        source: "/upgrade/:path*",
        headers: [...securityHeaders, ...authDocumentEdgeBypass],
      },
      {
        source: "/sign-in/:path*",
        headers: [...securityHeaders, ...authDocumentEdgeBypass],
      },
      {
        source: "/sign-up/:path*",
        headers: [...securityHeaders, ...authDocumentEdgeBypass],
      },
      // Root cause (2026-08-01 audit): this rule used to gate the no-store bypass on
      // `isStagingSite` (NEXT_PUBLIC_SITE_URL containing "staging."), a leftover from
      // when staging and production had different edge-cache postures. Staging was
      // fully decommissioned 2026-07-25 (see CLAUDE.md), so `isStagingSite` is now
      // permanently false — every document route matched by this catch-all (e.g.
      // /vector, /nighthawk, /admin, /terminal, /flows — anything not covered by the
      // explicit / , /upgrade, /sign-in, /sign-up rules above) was silently getting
      // bare `securityHeaders` in production, with NO Cache-Control/CDN-Cache-Control
      // at all. Since production is the only environment left, apply the same
      // no-store + Vary:Cookie bypass unconditionally instead of dead-conditionally.
      {
        source: "/((?!embed/|_next/).*)",
        headers: [...securityHeaders, ...authDocumentEdgeBypass],
      },
      {
        source: "/embed/:path*",
        headers: embedSecurityHeaders,
      },
    ];
  },
  images: {
    remotePatterns,
    minimumCacheTTL: 86400,
    // Next's default imageSizes ([16,32,48,64,96,128,256,384]) jumps straight to
    // deviceSizes' 640 next — nothing in between. Any `fill` image whose real
    // rendered width (accounting for DPR) lands in that 384-640 gap gets rounded
    // all the way up to 640, even when 480/576 would cover it. Measured live via
    // PageSpeed Insights: the homepage hero logo renders at 209x209 CSS px but
    // was served the 640 breakpoint, wasting 71KB of its 72.5KB total. Adding two
    // values into the gap is purely additive — Next always picks the SMALLEST
    // breakpoint that satisfies the request, so more granularity can only reduce
    // over-fetching, never increase it (no existing `sizes` prop needs to change).
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384, 480, 576],
  },
  // spx-desk-merge.ts is isomorphic (used by client hooks) and lazily pulls
  // shared-cache -> ioredis for cross-instance Redis sticky state. ioredis is only
  // ever exercised on the server (guarded by process.env.REDIS_URL), but webpack
  // still bundles it into the client graph. Stub its Node built-ins on the client
  // so the build doesn't fail on "Can't resolve 'stream'/'crypto'/'dns'/'net'/'tls'".
  // (This replaced a `webpackIgnore: true` hack that left an unresolvable
  //  import("@/lib/shared-cache") in the server runtime -> ERR_MODULE_NOT_FOUND.)
  webpack: (config, { isServer, nextRuntime }) => {
    if (!isServer) {
      // ioredis is server-only (pulled lazily by shared-cache for cross-instance
      // Redis sticky state, guarded by process.env.REDIS_URL). It must never enter
      // the client bundle — it imports Node built-ins (stream/crypto/dns/net/tls and
      // node:diagnostics_channel). Alias it to false on the client so webpack drops
      // the whole subtree; it is never executed in the browser (REDIS_URL is unset).
      config.resolve.alias = { ...config.resolve.alias, ioredis: false };
      config.resolve.fallback = {
        ...config.resolve.fallback,
        stream: false,
        crypto: false,
        dns: false,
        net: false,
        tls: false,
      };
    }
    // EDGE runtime: src/instrumentation.ts is bundled for BOTH the node and edge
    // runtimes (instrumentationHook). Its error sink lazily reaches @/lib/db -> pg,
    // and pg imports Node built-ins (fs/path/stream/...) that don't exist on edge,
    // failing the build. The edge path NEVER executes that code (instrumentation
    // returns early unless NEXT_RUNTIME === "nodejs"), so drop pg + its built-ins
    // from the edge graph exactly as we do for the client. The node server build is
    // untouched, so the DB sink still works at runtime.
    if (nextRuntime === "edge") {
      config.resolve.alias = { ...config.resolve.alias, pg: false, "pg-native": false };
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        dns: false,
        path: false,
        stream: false,
        crypto: false,
      };
    }
    return config;
  },
};

export default nextConfig;
