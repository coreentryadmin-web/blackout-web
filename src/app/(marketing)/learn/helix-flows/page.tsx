import type { Metadata } from "next";
import { LearnGuideView } from "@/components/learn/LearnGuideView";
import { helixFlowsGuide } from "@/lib/learn/guides";
import { publicPageMetadata } from "@/lib/page-metadata";

export const metadata: Metadata = publicPageMetadata(
  "HELIX Guide — Reading Institutional Options Flow",
  "Learn to read institutional options order flow with HELIX: premium filters, anomaly detection, and how to spot the unusual activity that moves markets.",
  "/learn/helix-flows"
);

export default function Page() {
  return <LearnGuideView guide={helixFlowsGuide} />;
}
