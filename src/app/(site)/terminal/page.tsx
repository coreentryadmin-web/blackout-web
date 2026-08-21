import type { Metadata } from "next";
import { requireDeskTool } from "@/lib/auth-access";
import { ComingSoon } from "@/components/ComingSoon";
import { LargoPageShell } from "@/features/largo/components/LargoPageShell";
import { noindexPageMetadata } from "@/lib/page-metadata";

export const dynamic = "force-dynamic";

export const metadata: Metadata = noindexPageMetadata("Largo · BlackOut", "/terminal");

export default async function TerminalPage() {
  if (!(await requireDeskTool("premium", "largo"))) return <ComingSoon toolKey="largo" />;

  return <LargoPageShell />;
}
