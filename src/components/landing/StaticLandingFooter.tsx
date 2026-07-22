import type { ReactNode } from "react";
import Link from "next/link";
import { SITE } from "@/lib/site";
import { WHOP_CHECKOUT } from "@/lib/whop-checkout";

const YEAR = new Date().getFullYear();

/** Official brand glyphs (24×24, currentColor). */
const ICONS: Record<string, ReactNode> = {
  x: <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />,
  instagram: <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163C8.741 0 8.332.014 7.052.072 2.695.272.273 2.69.073 7.052.014 8.332 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.332 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.668-.072-4.948-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />,
  discord: <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />,
};

/** A social/community connect link — icon key + accessible label, opens in a new tab. */
function SocialKey({ href, label, children, iosHide }: { href: string; label: string; children: ReactNode; iosHide?: boolean }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      title={label}
      className={`grid size-9 place-items-center rounded-lg border border-white/12 bg-white/[0.04] text-white/70 transition-colors hover:border-white/30 hover:bg-white/[0.08] hover:text-white${iosHide ? " hide-in-ios-app" : ""}`}
    >
      {children}
    </a>
  );
}

const INSTRUMENTS = [
  { label: "SPX Slayer", href: "/dashboard" },
  { label: "HELIX Flow", href: "/flows" },
  { label: "BlackOut Thermal", href: "/heatmap" },
  { label: "Largo", href: "/terminal" },
  { label: "Night Hawk", href: "/nighthawk" },
  { label: "Vector", href: "/pricing" },
];

const PLATFORM = [
  { label: "Learn", href: "/learn" },
  { label: "Pricing", href: "/pricing", iosHide: true },
  { label: "FAQ", href: "/faq" },
  { label: "Upgrade", href: "/upgrade", iosHide: true },
  { label: "Sign in", href: "/sign-in" },
  { label: "Start Trading", href: "/sign-up" },
];

function FooterLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link href={href} prefetch={false} className={className}>
      {children}
    </Link>
  );
}

export function StaticLandingFooter() {
  return (
    <footer className="mkt-footer relative z-10 px-4 md:px-8">
      <p className="mkt-footer-wm" aria-hidden>
        BLACKOUT
      </p>
      <div className="relative z-10 mx-auto grid max-w-6xl gap-10 md:grid-cols-4">
        <div>
          <p className="font-anton text-2xl text-white">BLACKOUT</p>
          <p className="mt-2 text-sm text-sky-300">{SITE.tagline}</p>

          <p className="mb-3 mt-6 font-mono text-[10px] uppercase tracking-[0.3em] text-bull/80">Connect</p>
          <div className="flex items-center gap-2.5">
            <SocialKey href={SITE.social.x.url} label={`Follow @${SITE.social.x.handle} on X`}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden>{ICONS.x}</svg>
            </SocialKey>
            <SocialKey href={SITE.social.instagram.url} label={`@${SITE.social.instagram.handle} on Instagram`}>
              <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden>{ICONS.instagram}</svg>
            </SocialKey>
            <SocialKey href={SITE.social.discord.url} label="Join the BlackOut Discord">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden>{ICONS.discord}</svg>
            </SocialKey>
            {WHOP_CHECKOUT.store && (
              // Neutral label — the vendor-surface guard (App-Store neutral-labeling
              // policy) forbids naming the payment provider in user-facing copy. The
              // "W" mark stays; only the aria/title text is neutralized. iosHide too.
              <SocialKey href={WHOP_CHECKOUT.store} label="Premium membership" iosHide>
                <span className="font-anton text-[13px] leading-none tracking-tight" aria-hidden>W</span>
              </SocialKey>
            )}
          </div>

          <a
            href={SITE.social.x.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-2 rounded-lg border border-white/12 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-white/80 no-underline transition-colors hover:border-white/30 hover:text-white"
          >
            <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden>{ICONS.x}</svg>
            Connect X
          </a>
        </div>
        <div>
          <p className="mb-4 font-mono text-[10px] uppercase tracking-[0.3em] text-bull/80">Instruments</p>
          <ul className="flex flex-col gap-2">
            {INSTRUMENTS.map((it) => (
              <li key={it.href}>
                <FooterLink href={it.href} className="text-sm text-white/75 no-underline hover:text-white">
                  {it.label}
                </FooterLink>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="mb-4 font-mono text-[10px] uppercase tracking-[0.3em] text-bull/80">Platform</p>
          <ul className="flex flex-col gap-2">
            {PLATFORM.map((it) => (
              <li key={it.href} className={it.iosHide ? "hide-in-ios-app" : undefined}>
                <FooterLink href={it.href} className="text-sm text-white/75 no-underline hover:text-white">
                  {it.label}
                </FooterLink>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-3">
          <FooterLink href="/sign-in" className="nav-signin">
            Sign in
          </FooterLink>
          <FooterLink href="/sign-up" className="nav-join">
            Get started
          </FooterLink>
          <p className="mt-4 text-xs text-sky-300/70">© {YEAR} {SITE.legalName}</p>
        </div>
      </div>
    </footer>
  );
}
