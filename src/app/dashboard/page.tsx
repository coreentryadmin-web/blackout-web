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
      <main className="relative z-10 w-full max-w-none px-2 sm:px-3 lg:px-4 xl:px-5 pt-20 pb-8">
        <SpxDashboard />
      </main>
    </div>
  );
}
