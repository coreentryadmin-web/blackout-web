import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ZeroDteCommandPreviewClient } from "./ZeroDteCommandPreviewClient";
import "../nighthawk-v2.css";
import "../nighthawk-desk-theme.css";

export const metadata: Metadata = {
  title: "0DTE Command Preview (dev)",
  robots: { index: false, follow: false },
};

/**
 * 0DTE Command Deck dev preview — session stats, gate blocks, Vector cross-links.
 * Visit /zerodte-command-preview while `npm run dev` is running.
 */
export default function ZeroDteCommandPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <ZeroDteCommandPreviewClient />;
}
