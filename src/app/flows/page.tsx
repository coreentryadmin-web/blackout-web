import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Nav } from "@/components/Nav";
import { FlowFeed } from "@/components/FlowFeed";

export default async function FlowsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  return (
    <div className="min-h-screen bg-black">
      <Nav />
      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex items-baseline gap-4 mb-8">
          <h1 className="font-display text-4xl tracking-[3px] text-white">FLOW FEED</h1>
          <span className="inline-flex items-center gap-1.5 text-[10px] tracking-[2px] text-bull uppercase">
            <span className="w-1.5 h-1.5 rounded-full bg-bull animate-pulse" />
            Live
          </span>
        </div>
        <FlowFeed />
      </main>
    </div>
  );
}
