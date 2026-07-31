import type { Metadata } from "next";
import { LearnGuideView } from "@/components/learn/LearnGuideView";
import { largoAiGuide } from "@/lib/learn/guides";
import { publicPageMetadata } from "@/lib/page-metadata";

export const metadata: Metadata = publicPageMetadata(
  "Largo Guide — Your AI Market Structure Analyst",
  "Learn how Largo, BlackOut's AI desk analyst, delivers structure-focused market context so you understand what the positioning data is actually telling you.",
  "/learn/largo-ai"
);

export default function Page() {
  return <LearnGuideView guide={largoAiGuide} />;
}
