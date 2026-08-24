import { requireTier } from "@/lib/auth-access";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Tier gate at layout level before rendering any children.
  // This ensures redirect() is handled before the error boundary can catch it.
  await requireTier("community");

  return children;
}
