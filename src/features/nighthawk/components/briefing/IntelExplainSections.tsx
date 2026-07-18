import { BriefingSection } from "./BriefingSection";
import type { BriefingIntelSection } from "@/features/nighthawk/lib/play-briefing-utils";

export function IntelExplainSections({ sections, cached }: { sections: BriefingIntelSection[]; cached?: boolean }) {
  if (!sections.length) return null;
  return (
    <div className="nh-v2-briefing-stack nh-v2-intel-sections">
      {cached && <p className="nh-v2-briefing-muted px-1">Cached edition briefing</p>}
      {sections.map((sec) => (
        <BriefingSection
          key={sec.title}
          title={sec.title}
          accent={sec.title.toLowerCase().includes("risk") ? "bear" : sec.title.toLowerCase().includes("bottom") ? "green" : "gold"}
        >
          <p className="nh-v2-briefing-prose whitespace-pre-wrap">{sec.body}</p>
        </BriefingSection>
      ))}
    </div>
  );
}
