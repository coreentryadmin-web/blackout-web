/**
 * Public marketing surface — lean CSS only (~8KB base + CTA styles, not full globals).
 * ISR: nav auth chrome heals client-side via __client_uat (NavAuthLinks).
 */
export const revalidate = 3600;

import "../marketing-base.css";
import "../marketing-shell.css";
import "../marketing-redesign.css";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
