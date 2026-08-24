import { requireAdmin } from "@/lib/admin-access";

export default async function EmbedTrackRecordLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Check admin access at layout level before rendering any children.
  // This ensures redirect() is handled before the error boundary can catch it.
  await requireAdmin();

  return children;
}
