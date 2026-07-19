import { redirect } from "next/navigation";

/** Legacy public URL — track record is admin-only under Admin console. */
export default function TrackRecordLegacyRedirect() {
  redirect("/admin?tab=track-record");
}
