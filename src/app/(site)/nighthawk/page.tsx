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

export default async function NightHawkPage({
  searchParams,
}: {
  searchParams?: Promise<{ view?: string }> | { view?: string };
}) {
  await requireTier("premium");
  if (!(await canAccessTool("nighthawk"))) return <ComingSoon toolKey="nighthawk" />;

  const sp = searchParams instanceof Promise ? await searchParams : searchParams;
  // Soft-fail: desk still renders; client SWR fetches if seed.board is null.
  const seed = await loadNightHawkSeedProps({ view: sp?.view }).catch(() => ({
    view: "ZERO_DTE" as const,
    board: null,
  }));

  return <NighthawkPageShell seed={seed} />;
}
