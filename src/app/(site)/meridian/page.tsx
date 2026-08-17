import type { Metadata } from "next";
import { requireTier } from "@/lib/auth-access";
import { canAccessTool } from "@/lib/tool-access-server";
import { ComingSoon } from "@/components/ComingSoon";
import { MeridianPageShell } from "@/features/meridian/components/MeridianPageShell";
import { noindexPageMetadata } from "@/lib/page-metadata";

export const dynamic = "force-dynamic";

export const metadata: Metadata = noindexPageMetadata("Meridian · BlackOut", "/meridian");

export default async function MeridianPage() {
  await requireTier("premium");
  if (!(await canAccessTool("meridian"))) return <ComingSoon toolKey="meridian" />;
  return <MeridianPageShell />;
}
