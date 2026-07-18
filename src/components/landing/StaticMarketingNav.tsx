import Link from "next/link";

const LINKS = [
  { href: "/#features", label: "Platform" },
  { href: "/#tape", label: "The tape" },
  { href: "/#gamma", label: "Gamma" },
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
          {signedIn ? (
            <Link href="/dashboard" prefetch={false} className="nav-join">
              Open desk →
            </Link>
          ) : (
            <>
              <Link href="/sign-in" prefetch={false} className="nav-signin">
                Sign in
              </Link>
              <Link href="/sign-up" prefetch={false} className="nav-join">
                Get access →
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
