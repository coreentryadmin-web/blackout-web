import type { Metadata } from "next";
import { requireTier } from "@/lib/auth-access";
import { canAccessTool } from "@/lib/tool-access-server";
import { ComingSoon } from "@/components/ComingSoon";
import { PageShell, PageHeader } from "@/components/ui";
import { ProductMark } from "@/components/marks/ProductMark";
import { GridPageTabs } from "@/components/zerodte/GridPageTabs";
import { GridTickerProvider } from "@/lib/grid/grid-ticker-context";

export const metadata: Metadata = {
  title: "0DTE Command · BlackOut",
  description:
    "The intraday command board — SPX engines, dossier-enriched 0DTE setups from the live tape, news, earnings and dealer positioning on one surface.",
};

/**
 * /grid — 0DTE Command (default tab) + the classic Market Grid (second tab).
 * Server Component: tier gate + launch gate + metadata; the client tabs own
 * layout/polling. Gated to `grid` (admins bypass), so non-admins see the
 * ComingSoon padlock until it ships.
 *
 * The GridTickerProvider still wraps everything so the classic tab's search bar
 * and panels share ticker state exactly as before.
 */
export default async function GridPage() {
  await requireTier("premium");
  if (!(await canAccessTool("grid"))) return <ComingSoon toolKey="grid" />;

  return (
    <PageShell fullBleed>
      <div className="px-2 sm:px-4 xl:px-6">
        <GridTickerProvider>
          <PageHeader
            kicker="Intraday command"
            title="0DTE Command"
            subtitle="The system heats up with the session — engines, tape-derived setups, news, earnings and dealer positioning on one board."
            badge={<ProductMark product="grid" size={44} />}
          />
          <div className="mt-5">
            <GridPageTabs />
          </div>
        </GridTickerProvider>
      </div>
    </PageShell>
  );
}
