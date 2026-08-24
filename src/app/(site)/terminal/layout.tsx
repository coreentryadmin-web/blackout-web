import { requireDeskTool } from "@/lib/auth-access";
import { ComingSoon } from "@/components/ComingSoon";

export default async function TerminalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Tier gate at layout level before rendering any children.
  // This ensures redirect() is handled before the error boundary can catch it.
  const access = await requireDeskTool("premium", "largo");
  if (!access) return <ComingSoon toolKey="largo" />;

  return children;
}
