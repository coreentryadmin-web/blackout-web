import { LearnSidebar } from "@/components/learn/LearnSidebar";
import { LearnMobileNav } from "@/components/learn/LearnMobileNav";
import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
// /learn now lives in the (marketing) group and wears the marketing chrome (was
// the authenticated app shell + LearnPageShell). The `.learn-*` / `.content-rail`
// classes live in globals.css, which the lean (marketing) layout doesn't load —
// import it here, scoped to the /learn subtree.
import "../../globals.css";

export default function LearnLayout({ children }: { children: React.ReactNode }) {
  return (
    <MarketingPageShell showChart={false}>
      {/* Clear the fixed marketing nav; MarketingPageShell owns the frame, so we
          drop the inner LearnPageShell/PageShell (no duplicate <main id="main">). */}
      <div className="learn-shell" style={{ paddingTop: "var(--nav-offset)" }}>
        <LearnMobileNav />
        <div className="learn-shell-grid">
          <aside className="learn-shell-aside hidden lg:block">
            <LearnSidebar />
          </aside>
          <div className="learn-shell-main min-w-0 py-8 md:py-10">{children}</div>
        </div>
      </div>
    </MarketingPageShell>
  );
}
