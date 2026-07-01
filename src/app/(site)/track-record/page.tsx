import { redirect } from "next/navigation";

/** Legacy public URL — track record is admin-only at /admin/track-record. */
export default function TrackRecordLegacyRedirect() {
  redirect("/admin/track-record");
}
