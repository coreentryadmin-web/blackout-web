import type { Metadata } from "next";
import { LearnGuideView } from "@/components/learn/LearnGuideView";
import { spxSlayerGuide } from "@/lib/learn/guides";
import { publicPageMetadata } from "@/lib/page-metadata";

export const metadata: Metadata = publicPageMetadata(
  "SPX Slayer Guide — Trading 0DTE SPX Options",
  "Learn how SPX Slayer's 0DTE desk works: gamma matrices, tick-by-tick data, and A–F graded SPX alerts, and how to act on the setups that survive screening.",
  "/learn/spx-slayer"
);

export default function Page() {
  return <LearnGuideView guide={spxSlayerGuide} />;
}
