import { TrackRecordSkeleton } from "@/components/track-record";

export default function AdminTrackRecordLoading() {
  return (
    <div className="admin-page admin-page-canvas">
      <main id="main" className="admin-page-main">
        <TrackRecordSkeleton />
      </main>
    </div>
  );
}
