import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Nav } from "@/components/Nav";
import { LargoTerminal } from "@/components/LargoTerminal";

export default async function TerminalPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  return (
    <div className="min-h-screen bg-black flex flex-col">
      <Nav />
      <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-8 flex flex-col">
        <div className="flex items-baseline gap-4 mb-6">
          <h1 className="font-display text-4xl tracking-[3px] text-white">AI TERMINAL</h1>
          <span className="text-[10px] tracking-[2px] text-text-muted uppercase">Largo — BlackOut Desk</span>
        </div>
        <LargoTerminal />
      </main>
    </div>
  );
}
