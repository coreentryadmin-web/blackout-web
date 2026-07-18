import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ZeroDteLiveSimDemo } from "@/features/nighthawk/components/ZeroDteLiveSimDemo";

export const metadata: Metadata = {
  title: "0DTE Live Sim · Dev · BlackOut",
  description: "Mock market-data replay of a committed 0DTE play at 1Hz (SSE lane).",
};

export const revalidate = 0;

/** Dev-only harness — replays production latch + intel math without UW/Polygon keys. */
export default function ZeroDteLiveSimPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <div className="min-h-[calc(100svh-var(--nav-offset))] bg-[#050a12] text-sky-100">
      <ZeroDteLiveSimDemo />
    </div>
  );
}
