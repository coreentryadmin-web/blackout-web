export const dynamic = "force-dynamic";

import { requireDeskTool } from "@/lib/auth-access";
import { ComingSoon } from "@/components/ComingSoon";
import "../../nighthawk-v2.css";
import "../../nighthawk-desk-theme.css";

export default async function NighthawkLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Tier gate at layout level before rendering any children.
  // This ensures redirect() is handled before the error boundary can catch it.
  const access = await requireDeskTool("premium", "nighthawk");
  if (!access) return <ComingSoon toolKey="nighthawk" />;

  return children;
}
