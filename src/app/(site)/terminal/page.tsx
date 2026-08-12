import type { Metadata } from "next";
import { requireTier } from "@/lib/auth-access";
import { canAccessTool } from "@/lib/tool-access-server";
import { ComingSoon } from "@/components/ComingSoon";
import { LargoPageShell } from "@/features/largo/components/LargoPageShell";
import { noindexPageMetadata } from "@/lib/page-metadata";

export const dynamic = "force-dynamic";

export const metadata: Metadata = noindexPageMetadata("Largo · BlackOut", "/terminal");

export default async function TerminalPage() {
  await requireTier("premium");
  if (!(await canAccessTool("largo"))) return <ComingSoon toolKey="largo" />;

  return <LargoPageShell />;
}
