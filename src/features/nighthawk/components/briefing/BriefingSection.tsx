import { clsx } from "clsx";
import type { ReactNode } from "react";

type Accent = "gold" | "green" | "sky" | "bear";

export function BriefingSection({
  title,
  accent = "gold",
  children,
  className,
}: {
  title: string;
  accent?: Accent;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={clsx("nh-v2-briefing-section", `nh-v2-briefing-section--${accent}`, className)}>
      <h4 className="nh-v2-briefing-section-title">{title}</h4>
      <div className="nh-v2-briefing-section-body">{children}</div>
    </section>
  );
}
