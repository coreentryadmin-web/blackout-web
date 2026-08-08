import { BreadcrumbJsonLd } from "./JsonLd";

// Contrast: 11px uppercase at white/40 on the near-black marketing background measured well
// under WCAG AA for small text. Raised to white/60 for the trail and white/80 for the current page —
// still clearly secondary to the H1, but actually readable.

type BreadcrumbItem = { name: string; href: string };

export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  return (
    <>
      <BreadcrumbJsonLd items={items} />
      <nav aria-label="Breadcrumb" className="mb-6 font-mono text-[11px] uppercase tracking-[0.18em] text-white/60">
        <ol className="flex flex-wrap items-center gap-1">
          {items.map((item, i) => (
            <li key={item.href} className="flex items-center gap-1">
              {i > 0 && <span aria-hidden className="text-white/35">/</span>}
              {i === items.length - 1 ? (
                <span className="text-white/80" aria-current="page">{item.name}</span>
              ) : (
                <a href={item.href} className="transition-colors hover:text-white/70">{item.name}</a>
              )}
            </li>
          ))}
        </ol>
      </nav>
    </>
  );
}
