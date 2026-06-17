import { requireTier } from "@/lib/auth-access";
import { Nav } from "@/components/Nav";
import { SpxDashboard } from "@/components/SpxDashboard";
import { IMAGES } from "@/lib/images";

export const revalidate = 0;

export default async function DashboardPage() {
  await requireTier("premium");

  return (
    <div className="spx-sniper-page">
      <div
        className="spx-sniper-bg"
        style={{ backgroundImage: `url(${IMAGES.dashboardBg})` }}
        aria-hidden
      />
      <div className="spx-sniper-overlay" aria-hidden />
      <Nav />
      <main className="relative z-10 max-w-[1600px] mx-auto px-4 md:px-6 pt-20 pb-12">
        <SpxDashboard />
      </main>
    </div>
  );
}
