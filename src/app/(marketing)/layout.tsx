/**
 * Public marketing surface — uses full globals.css so a single stylesheet
 * carries Tailwind + void-bg + tokens. Splitting into marketing-base.css
 * produced 3 CSS chunks; during deploy Cloudflare cached 404s on 2/3 and the
 * page rendered unstyled (green SVG only). Shell/CTA CSS stays separate.
 */
import "../globals.css";
import "../marketing.css";
import "../marketing-shell.css";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
