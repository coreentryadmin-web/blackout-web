export const dynamic = "force-dynamic";

import { requireDeskTool } from "@/lib/auth-access";
import { ComingSoon } from "@/components/ComingSoon";

export default async function VectorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Tier gate at layout level before rendering any children.
  // This ensures redirect() is handled before the error boundary can catch it.
  const access = await requireDeskTool("premium", "vector");
  if (!access) return <ComingSoon toolKey="vector" />;

  return children;
}
