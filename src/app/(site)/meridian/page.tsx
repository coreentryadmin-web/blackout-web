import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-access";
import { MeridianPageShell } from "@/features/meridian/components/MeridianPageShell";
import { noindexPageMetadata } from "@/lib/page-metadata";

export const dynamic = "force-dynamic";

export const metadata: Metadata = noindexPageMetadata("Meridian · BlackOut", "/meridian");

/** Admin-only preview until Meridian is fully developed and launch-gated for members. */
export default async function MeridianPage() {
  await requireAdmin();
  return <MeridianPageShell />;
}
