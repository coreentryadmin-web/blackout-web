import { clsx } from "clsx";

export type BriefingTabId = "overview" | "scoring" | "intel";

const TABS: { id: BriefingTabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "scoring", label: "Scoring" },
  { id: "intel", label: "Hawk Intel" },
];

export function BriefingTabs({
  value,
  onChange,
  intelLoading,
}: {
  value: BriefingTabId;
  onChange: (id: BriefingTabId) => void;
  intelLoading?: boolean;
}) {
  return (
    <div className="nh-v2-briefing-tabs" role="tablist" aria-label="Play briefing">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={value === tab.id}
          className={clsx("nh-v2-briefing-tab", value === tab.id && "nh-v2-briefing-tab--active")}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {tab.id === "intel" && intelLoading && <span className="nh-v2-briefing-tab-dot" aria-hidden />}
        </button>
      ))}
    </div>
  );
}
