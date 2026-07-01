import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin-access";
import { TrackRecordView } from "@/components/track-record";

export const metadata: Metadata = {
  title: "Track Record · Admin · BlackOut",
  description:
    "Verified SPX Slayer and Night Hawk signal results — admin-only performance ledger.",
};

export const revalidate = 0;

export default async function AdminTrackRecordPage() {
  await requireAdmin();

  return (
    <div className="admin-page admin-page-canvas">
      <main id="main" className="admin-page-main">
        <p className="mb-4 font-mono text-[11px] uppercase tracking-widest text-white/35">
          <Link href="/admin" className="transition-colors hover:text-bull">
            ← Admin
          </Link>
        </p>
        <TrackRecordView />
      </main>
    </div>
  );
}
