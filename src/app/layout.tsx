import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { googleAdsConversionId } from "@/lib/analytics/google-ads";
import localFont from "next/font/local";
import { IMAGES } from "@/lib/images";
import { SITE } from "@/lib/site";
import { Ga4Attribution } from "@/components/analytics/Ga4Attribution";
import { OrganizationJsonLd, WebSiteJsonLd } from "@/components/seo/JsonLd";
import { bingSiteVerificationToken, googleSiteVerificationToken } from "@/lib/seo/verification";
// PHOSPHOR LADDER token foundation — additive tokens + utility primitives, loaded
// ONCE here so marketing = desk = ios all read the same instrument grid. Placed in
// the root layout (globals.css is only imported per route-group) so the tokens are
// truly global.
import "./phosphor-tokens.css";
// Command-key button system (.bo-btn). Global (not imported from Button.tsx) so
// the tsx test runner — which can't parse per-component CSS imports — stays happy
// and every surface reads the same button styles. Loads after the tokens it uses.
import "@/components/ui/button.css";
// Phosphor Boot loader styles (route-transition splash). Global, same rationale
// as button.css above — loading.tsx must stay a dependency-light server component,
// so its keyframes/rules live here rather than being imported per-component.
import "./phosphor-loading.css";
// Phosphor motion primitives (BorderBeam, RetroGrid) — Magic-UI-caliber effects
// re-authored natively in the phosphor language. Global for the same reason as
// the loaders: the primitives are pure-CSS server components.
import "./phosphor-motion.css";

/**
 * FONTS ARE COMMITTED, NOT FETCHED AT BUILD TIME.
 *
 * `next/font/google` downloads the face during `next build`. On 2026-08-11 that fetch failed —
 *
 *   [Error: Failed to fetch font file from `https://fonts.gstatic.com/s/jetbrainsmono/...woff2`]
 *   Failed to compile. src/app/layout.tsx: `next/font` error
 *
 * — and took the whole production deploy down with it (run 31484348086). Nothing was wrong with
 * the commit; a third-party CDN blinked during the Docker build.
 *
 * The brand font loader already knew this. `src/lib/brand/font-buffers.ts` commits its
 * `.ttf` files and says why: a render path that fetched a font "would fail closed on a network
 * blip and — worse — could silently fall back to a different face". The same argument applies at
 * build time, where the blast radius is every page rather than one card. Two opposite policies in
 * one repo, and the fetching one is the one that cost a deploy.
 *
 * BYTE-IDENTICAL to what was being fetched: the latin subset each `subsets: ["latin"]` call
 * already resolved to, pulled from the same gstatic URLs. Syne and JetBrains Mono are VARIABLE
 * fonts — Google serves ONE file per family covering every weight (verified by md5: the three
 * Syne weights and four JetBrains weights were the same bytes four times over), so this is three
 * files rather than eight. Anton ships a single 400 face. 84KB total.
 *
 * All three are SIL Open Font License, which permits redistribution.
 */
const anton = localFont({
  src: "./fonts/anton-400.woff2",
  weight: "400",
  style: "normal",
  display: "swap",
  variable: "--font-anton",
});
const syne = localFont({
  src: "./fonts/syne-variable.woff2",
  // The variable file carries the whole axis; this range spans the 600/700/800 the old call asked
  // for, so every existing `font-weight` in the CSS still resolves to a real instance.
  weight: "400 800",
  style: "normal",
  display: "swap",
  variable: "--font-syne",
});
// The instrument mono — data IS the wallpaper in the PHOSPHOR LADDER system, so
// numerals, tickers, kickers and command keys are set in JetBrains Mono. The
// token/motion/button CSS references var(--font-jetbrains); load it here so it
// resolves to the intended face instead of falling back to system monospace.
const jetbrainsMono = localFont({
  src: "./fonts/jetbrains-mono-variable.woff2",
  weight: "100 800",
  style: "normal",
  display: "swap",
  variable: "--font-jetbrains",
});
export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: `${SITE.name} — ${SITE.tagline}`,
  description: SITE.description,
  alternates: { canonical: SITE.url },
  openGraph: {
    title: SITE.name,
    description: SITE.tagline,
    siteName: SITE.name,
    url: SITE.url,
    images: [{ url: IMAGES.ogImage, width: 1577, height: 997, alt: "BlackOut — 6 live engines, institutional-grade trading desk" }],
  },
  twitter: {
    card: "summary_large_image",
    site: `@${SITE.social.x.handle}`,
    title: SITE.name,
    description: SITE.tagline,
    images: [IMAGES.ogImage],
  },
  ...(googleSiteVerificationToken() || bingSiteVerificationToken()
    ? {
        verification: {
          ...(googleSiteVerificationToken() ? { google: googleSiteVerificationToken() } : {}),
          ...(bingSiteVerificationToken()
            ? { other: { "msvalidate.01": bingSiteVerificationToken()! } }
            : {}),
        },
      }
    : {}),
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: SITE.name, statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#040407",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${anton.variable} ${syne.variable} ${jetbrainsMono.variable}`}>
      <head>
        <link rel="preconnect" href={SITE.url} />
        <link rel="dns-prefetch" href={SITE.url} />
        <link rel="alternate" type="application/rss+xml" title="BlackOut Trades — Learn" href="/feed.xml" />
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var p=location.pathname;if(/^\\/(dashboard|flows|heatmap|terminal|nighthawk|vector|grid|account|admin|upgrade)(\\/|$)/.test(p)){document.documentElement.classList.add('product-shell')}if(/BlackOutiOSApp/.test(navigator.userAgent)){document.documentElement.classList.add('ios-app');var m=document.querySelector('meta[name=viewport]');if(m)m.setAttribute('content','width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover');var cw=Math.min(window.screen.width,window.innerWidth||window.screen.width);if(cw>=430){document.documentElement.classList.add('ios-tier-pro-max')}else if(cw>=393){document.documentElement.classList.add('ios-tier-pro')}if(/^\\/(dashboard|flows|heatmap|terminal|nighthawk|vector|grid|account|faq|learn|upgrade|admin)(\\/|$)/.test(p)){document.documentElement.classList.add('ios-app-pending-shell');if(p==='/dashboard'||p.indexOf('/dashboard/')===0)document.documentElement.setAttribute('data-ios-route','dashboard');else if(p.indexOf('/flows')===0)document.documentElement.setAttribute('data-ios-route','flows');else if(p.indexOf('/heatmap')===0)document.documentElement.setAttribute('data-ios-route','heatmap');else if(p.indexOf('/terminal')===0)document.documentElement.setAttribute('data-ios-route','largo');else if(p.indexOf('/nighthawk')===0)document.documentElement.setAttribute('data-ios-route','nighthawk');else if(p.indexOf('/vector')===0)document.documentElement.setAttribute('data-ios-route','vector');else if(p.indexOf('/account')===0)document.documentElement.setAttribute('data-ios-route','account')}}if(/BlackOutNativeEmbed/.test(navigator.userAgent)){document.documentElement.classList.add('ios-native-embed')}}catch(e){}",
          }}
        />
        {/* Mid-deploy chunk-recovery guard: the freshly-served HTML can reference chunk hashes the
            edge hasn't caught up to during a rollout, so a member who loads mid-deploy gets a
            ChunkLoadError + blank page. One-shot guarded reload pulls the correct chunks once the
            deploy settles. Capped (≤3 reloads, ≥8s apart, via sessionStorage) so a persistent
            failure can't loop. Pattern mirrors `@/lib/chunk-reload` (CHUNK_ERROR_PATTERN_SOURCE),
            kept in sync by chunk-reload.test.ts. Inline in <head> so it catches failures that occur
            before React hydrates. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var RE=/ChunkLoadError|Loading chunk [0-9]+ failed|Loading CSS chunk|Failed to fetch dynamically imported module|error loading dynamically imported module|Refused to execute script|Refused to apply style|Importing a module script failed/i;var K='blackout:chunk-reload';var BK='blackout:build-id';var bid=document.querySelector('script[src*=\"/_next/static/\"]');var curBuild=bid&&(bid.src.match(/_next\\/static\\/([^\\/]+)\\//)||[])[1]||'';var prevBuild='';try{prevBuild=sessionStorage.getItem(BK)||''}catch(e){}if(curBuild&&curBuild!==prevBuild){try{sessionStorage.removeItem(K);sessionStorage.setItem(BK,curBuild)}catch(e){}}function reload(){try{var raw=sessionStorage.getItem(K);var st=raw?JSON.parse(raw):{n:0,t:0};var now=Date.now();if(st.n>=3||now-st.t<8000)return;sessionStorage.setItem(K,JSON.stringify({n:st.n+1,t:now}))}catch(e){}try{var bp=location.pathname;var bb=JSON.stringify({message:'chunk-reload',name:'ChunkReload',url:bp});if(navigator.sendBeacon)navigator.sendBeacon('/api/telemetry/client-error',new Blob([bb],{type:'application/json'}))}catch(e){}location.reload()}window.addEventListener('error',function(e){try{var t=e&&e.target;if(t&&(t.tagName==='SCRIPT'||t.tagName==='LINK')&&/_next\\/static\\/(chunks|css)\\//.test(t.src||t.href||'')){reload();return}if(e&&RE.test(String(e.message||''))){reload()}}catch(_){}},true);window.addEventListener('unhandledrejection',function(e){try{var r=e&&e.reason;if(r&&RE.test(String(r&&r.message||r||''))){reload()}}catch(_){}})}catch(e){}})();",
          }}
        />
        {/* SSR streaming safety net — if React's $RC reveal callback hasn't fired
            after 5s (GPU compositing collapse can block the paint
            that triggers the reveal), force-reveal any pending Suspense boundaries. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "setTimeout(function(){try{if(typeof $RV==='function'&&typeof $RB!=='undefined'&&$RB.length>0)$RV($RB)}catch(e){}},5000);",
          }}
        />
      </head>
      <body className="void-bg antialiased">
        <Script src="https://www.googletagmanager.com/gtag/js?id=G-YLN4K37KYF" strategy="afterInteractive" />
        <Script id="ga4-init" strategy="afterInteractive">
          {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','G-YLN4K37KYF');${
            googleAdsConversionId() ? `gtag('config','${googleAdsConversionId()}');` : ""
          }`}
        </Script>
        <Script id="x-pixel" strategy="afterInteractive">
          {`!function(e,t,n,s,u,a){e.twq||(s=e.twq=function(){s.exe?s.exe.apply(s,arguments):s.queue.push(arguments);},s.version='1.1',s.queue=[],u=t.createElement(n),u.async=!0,u.src='https://static.ads-twitter.com/uwt.js',a=t.getElementsByTagName(n)[0],a.parentNode.insertBefore(u,a))}(window,document,'script');twq('config','re1j3');`}
        </Script>
        <Ga4Attribution />
        <OrganizationJsonLd />
        <WebSiteJsonLd />
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[300] focus:rounded-lg focus:border focus:border-bull/50 focus:bg-black/90 focus:px-4 focus:py-2 focus:font-mono focus:text-xs focus:uppercase focus:tracking-[0.2em] focus:text-bull focus:outline-none"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
