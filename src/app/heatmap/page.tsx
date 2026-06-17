import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Nav } from "@/components/Nav";
import { Heatmap } from "@/components/Heatmap";

export default async function HeatmapPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  return (
    <div className="min-h-screen bg-black">
      <Nav />
      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex items-baseline gap-4 mb-8">
          <h1 className="font-display text-4xl tracking-[3px] text-white">HEATMAPS</h1>
          <span className="text-[10px] tracking-[2px] text-text-muted uppercase">Sector & Stock Performance</span>
        </div>
        <Heatmap />
      </main>
    </div>
  );
}
