import type { Metadata } from "next";
import { requireTier } from "@/lib/auth-access";
import { canAccessTool } from "@/lib/tool-access-server";
import { ComingSoon } from "@/components/ComingSoon";
import { NighthawkPageShell } from "@/features/nighthawk/components/NighthawkPageShell";
import { loadNightHawkSeedProps } from "@/features/nighthawk/lib/nighthawk-seed-props";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Night Hawk · BlackOut",
  description: "Tomorrow's playbook — evening setups ranked and scored for the next session.",
};

type PageProps = {
  searchParams: Promise<{ view?: string }>;
};

export default async function NightHawkPage({ searchParams }: PageProps) {
  await requireTier("premium");
  if (!(await canAccessTool("nighthawk"))) return <ComingSoon toolKey="nighthawk" />;

  const { view } = await searchParams;
  // Soft-fail: desk still renders; client SWR fetches if seed.board is null.
  const seed = await loadNightHawkSeedProps({ view }).catch(() => ({
    view: "ZERO_DTE" as const,
    board: null,
  }));

  return <NighthawkPageShell seed={seed} />;
}
