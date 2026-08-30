import type { MouseEvent } from "react";

/** Same-page homepage hash links — Next client nav often drops the fragment or skips scroll. */
export function handleMarketingHomeHashClick(
  href: string,
  beforeNavigate?: () => void,
): (e: MouseEvent<HTMLAnchorElement>) => void {
  return (e) => {
    beforeNavigate?.();
    const hashIdx = href.indexOf("#");
    if (hashIdx === -1) return;
    const hash = href.slice(hashIdx);
    const pathPart = href.slice(0, hashIdx);
    const isHomeHash = hash.startsWith("#") && (pathPart === "" || pathPart === "/");
    if (!isHomeHash || typeof window === "undefined" || window.location.pathname !== "/") return;
    e.preventDefault();
    const id = hash.slice(1);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    history.replaceState(null, "", `${window.location.pathname}${window.location.search}${hash}`);
  };
}
