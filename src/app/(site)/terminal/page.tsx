import type { Metadata } from "next";
import { LargoPageShell } from "@/features/largo/components/LargoPageShell";
import { noindexPageMetadata } from "@/lib/page-metadata";

export const dynamic = "force-dynamic";

export const metadata: Metadata = noindexPageMetadata("Largo · BlackOut", "/terminal");

export default function TerminalPage() {
  return <LargoPageShell />;
}
