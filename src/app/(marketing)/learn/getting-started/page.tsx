import type { Metadata } from "next";
import { LearnGuideView } from "@/components/learn/LearnGuideView";
import { gettingStartedGuide } from "@/lib/learn/guides";
import { publicPageMetadata } from "@/lib/page-metadata";

export const metadata: Metadata = publicPageMetadata(
  "Getting Started With BlackOut — Trader's Quick Guide",
  "New to BlackOut? Start here. Learn how the platform scans, grades, and logs setups, and how to read your first dealer gamma and options flow signals.",
  "/learn/getting-started"
);

export default function GettingStartedPage() {
  return <LearnGuideView guide={gettingStartedGuide} />;
}
