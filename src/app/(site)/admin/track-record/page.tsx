import { redirect } from "next/navigation";

/** Legacy admin URL — track record lives in the Admin console tab panel. */
export default function AdminTrackRecordRedirect() {
  redirect("/admin?tab=track-record");
}
