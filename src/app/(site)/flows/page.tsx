import type { Metadata } from "next";
import { HelixPageShell } from "@/features/helix/components/HelixPageShell";
import { noindexPageMetadata } from "@/lib/page-metadata";

export const dynamic = "force-dynamic";

export const metadata: Metadata = noindexPageMetadata("HELIX · BlackOut", "/flows");

export default function FlowsPage() {
  return <HelixPageShell />;
}
