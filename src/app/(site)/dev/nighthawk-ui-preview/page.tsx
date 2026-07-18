import { notFound } from "next/navigation";
import { NighthawkUiPreview } from "@/features/nighthawk/components/NighthawkUiPreview";

/** Dev-only full-page mock for Night Hawk v2 screenshots. Not linked in prod nav. */
export default function NighthawkUiPreviewPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }
  return <NighthawkUiPreview />;
}
