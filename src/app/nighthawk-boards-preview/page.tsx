import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { NightHawkBoardsPreviewClient } from "./NightHawkBoardsPreviewClient";
import "../nighthawk-v2.css";
import "../nighthawk-desk-theme.css";
import "../vector-board-controls.css";

export const metadata: Metadata = {
  title: "Night Hawk Boards Preview (dev)",
  robots: { index: false, follow: false },
};

/**
 * Side-by-side Vector + Legacy X Ads boards — no Clerk, no DB.
 * Visit /nighthawk-boards-preview while `npm run dev` is running.
 */
export default function NightHawkBoardsPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <NightHawkBoardsPreviewClient />;
}
