/** Axis-aligned overlap — used to keep the mobile sticky bar off FAQ/footer tap targets. */
export function rectsOverlap(a: StickyOverlapRect, b: StickyOverlapRect): boolean {
  return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
}

export type StickyOverlapRect = Pick<DOMRectReadOnly, "top" | "right" | "bottom" | "left">;

/** True when the fixed sticky bar would sit on top of an FAQ row or the footer CTA block. */
export function mobileStickyBlockedByContent(
  sticky: StickyOverlapRect,
  faqItemRects: StickyOverlapRect[],
  footerRect: StickyOverlapRect | null
): boolean {
  for (const faq of faqItemRects) {
    if (rectsOverlap(sticky, faq)) return true;
  }
  if (footerRect && rectsOverlap(sticky, footerRect)) return true;
  return false;
}

/** Whether the bar should paint visible given hero scroll state and overlap suppression. */
export function shouldShowMobileStickyCta(heroPast: boolean, blockedByContent: boolean): boolean {
  return heroPast && !blockedByContent;
}
