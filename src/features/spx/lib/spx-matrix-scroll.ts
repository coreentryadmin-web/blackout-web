/** Center a row inside an overflow scroll container (matrix spot ladder). */
export function scrollRowIntoViewCenter(scrollEl: HTMLElement, rowEl: HTMLElement): void {
  const scrollRect = scrollEl.getBoundingClientRect();
  const rowRect = rowEl.getBoundingClientRect();
  const delta = rowRect.top - scrollRect.top - (scrollRect.height - rowRect.height) / 2;
  scrollEl.scrollTop += delta;
}
