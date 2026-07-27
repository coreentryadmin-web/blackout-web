import type { ReactNode } from "react";

export function LegalPageLayout({
  kicker,
  title,
  updated,
  children,
}: {
  kicker: string;
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <div className="rl">
      <section className="legal-page">
        <div className="legal-wrap">
          <div className="legal-header">
            <span className="rl-kicker">
              <span className="dot" aria-hidden />
              {kicker}
            </span>
            <h1>{title}</h1>
            <p className="legal-updated">Last updated: {updated}</p>
          </div>
          <div className="legal-body">{children}</div>
        </div>
      </section>
    </div>
  );
}
