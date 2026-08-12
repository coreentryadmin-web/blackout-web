import type { Metadata } from "next";
import { requireTier } from "@/lib/auth-access";
import { HelixPageShell } from "@/features/helix/components/HelixPageShell";
import { noindexPageMetadata } from "@/lib/page-metadata";

export const dynamic = "force-dynamic";

export const metadata: Metadata = noindexPageMetadata("HELIX · BlackOut", "/flows");

export default async function FlowsPage() {
  await requireTier("premium");

  return <HelixPageShell />;
}
