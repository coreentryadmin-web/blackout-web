import type { Metadata } from "next";
import { requireDeskTool } from "@/lib/auth-access";
import { ComingSoon } from "@/components/ComingSoon";
import { MeridianPageShell } from "@/features/meridian/components/MeridianPageShell";
import { noindexPageMetadata } from "@/lib/page-metadata";

export const dynamic = "force-dynamic";

export const metadata: Metadata = noindexPageMetadata("Meridian · BlackOut", "/meridian");

export default async function MeridianPage() {
  if (!(await requireDeskTool("premium", "meridian"))) return <ComingSoon toolKey="meridian" />;
  return <MeridianPageShell />;
}
