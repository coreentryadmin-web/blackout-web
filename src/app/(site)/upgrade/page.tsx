export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { UpgradePageShell } from "@/components/desk/UpgradePageShell";

export const metadata: Metadata = {
  title: "Upgrade · BlackOut",
  description: "Unlock the live BlackOut desk — HELIX flow, SPX Slayer, Largo, and Night Hawk.",
};

export default function UpgradePage() {
  return <UpgradePageShell />;
}
