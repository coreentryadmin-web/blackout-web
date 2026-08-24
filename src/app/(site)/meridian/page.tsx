import type { Metadata } from "next";
import { MeridianPageShell } from "@/features/meridian/components/MeridianPageShell";
import { noindexPageMetadata } from "@/lib/page-metadata";

export const dynamic = "force-dynamic";

export const metadata: Metadata = noindexPageMetadata("Meridian · BlackOut", "/meridian");

export default function MeridianPage() {
  return <MeridianPageShell />;
}
