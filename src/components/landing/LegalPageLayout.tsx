import type { ReactNode } from "react";

export function LegalPageLayout({
  kicker,
  title,
  updated,
  breadcrumbs,
  children,
}: {
  kicker: string;
  title: string;
  updated: string;
  /**
   * Rendered inside `.legal-wrap`, above the header.
   *
   * Takes the breadcrumb as a prop rather than letting the page render it as a sibling of this
   * component. `MarketingPageShell`'s `<main>` has NO top padding — the 6rem that clears the fixed
   * nav lives on `.legal-page` — so a breadcrumb placed before this component lands at y=0, behind
   * the header, in white/40 on near-black. It was in the DOM and in the JSON-LD, and invisible to
   * a reader. Found by screenshotting prod, not by any HTML assertion, which all passed.
   */
  breadcrumbs?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rl">
      <section className="legal-page">
        <div className="legal-wrap">
          {breadcrumbs}
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
