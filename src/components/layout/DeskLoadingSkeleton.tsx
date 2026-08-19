import { Skeleton } from "@/components/ui";
import { PhosphorBoot } from "@/components/ui/loading/PhosphorBoot";

/** Layout-matched desk route skeleton — shared by route loading.tsx files. */
export function DeskLoadingSkeleton({
  variant = "default",
  label = "Loading desk",
}: {
  variant?: "default" | "terminal";
  /** Visible status copy — silent skeleton-only loaders read as a stuck blank page during slow RSC. */
  label?: string;
}) {
  if (variant === "terminal") {
    return (
      <div className="desk-route-loading mx-auto max-w-3xl space-y-4 px-4 py-8">
        <PhosphorBoot label={label} />
        <Skeleton width="40%" height={28} rounded="md" />
        <Skeleton width="100%" height={420} rounded="2xl" />
      </div>
    );
  }

  return (
    <div className="desk-route-loading space-y-4 px-3 py-4 md:px-5">
      <PhosphorBoot label={label} />
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-white/[0.06] pb-6">
        <div className="space-y-2">
          <Skeleton width={120} height={12} rounded="sm" />
          <Skeleton width={220} height={32} rounded="md" />
        </div>
        <Skeleton width={160} height={36} rounded="full" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="space-y-3 lg:col-span-8">
          <Skeleton width="100%" height={48} rounded="lg" />
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} width="100%" height={72} rounded="lg" />
          ))}
        </div>
        <div className="hidden space-y-3 lg:col-span-4 lg:block">
          <Skeleton width="100%" height={140} rounded="2xl" />
          <Skeleton width="100%" height={120} rounded="2xl" />
        </div>
      </div>
    </div>
  );
}
