import Link from "next/link";
import { NavAuthLinks } from "./NavAuthLinks";

// Anchors must match the real section ids in RedesignHome:
// #protocol = "Identify. Validate. Execute." (the platform process)
// #modules  = "Six engines. One edge." (the product carousel)
const LINKS = [
  { href: "/#protocol", label: "Platform" },
  { href: "/#modules", label: "Products" },
  { href: "/tools/gamma-snapshot", label: "Free Tool" },
  { href: "/learn", label: "Learn" },
  { href: "/faq", label: "FAQ" },
  { href: "/pricing", label: "Pricing", iosHide: true },
];

export function StaticMarketingNav({ signedIn = false }: { signedIn?: boolean }) {
  return (
    <header className="mkt-nav">
      <div className="mkt-nav-inner">
        <Link href="/" prefetch={false} className="mkt-wordmark font-anton">
          BLACKOUT
        </Link>
        <nav className="mkt-nav-links hide-in-ios-app" aria-label="Marketing">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} prefetch={false} className={l.iosHide ? "hide-in-ios-app" : undefined}>
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="mkt-nav-auth">
          {/* Client-reconciled from the __client_uat cookie so the auth chrome is
              correct even on statically-generated / edge-cached marketing pages. */}
          <NavAuthLinks signedIn={signedIn} />
        </div>
      </div>
    </header>
  );
}
