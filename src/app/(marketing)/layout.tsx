/**
 * Public marketing surface — lean CSS only (~8KB base + CTA styles, not full globals).
 * force-dynamic: nav reads __session for signed-in CTA (Open desk vs Sign in).
 */
export const dynamic = "force-dynamic";

import "../marketing-base.css";
import "../marketing.css";
import "../marketing-shell.css";
import "../marketing-redesign.css";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
