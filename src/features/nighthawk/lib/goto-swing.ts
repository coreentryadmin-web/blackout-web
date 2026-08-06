// Cross-deck navigation: a Legacy play card's "moved to Swings Open" link needs to switch the
// Night Hawk feed's active view to SWING and focus that ticker's row — but the view-switch state
// lives in NightHawkFeed (top of the tree) while the link renders deep inside LegacyDeck's own
// PlayTerminal, several components away with no callback prop threaded between them. A DOM
// CustomEvent avoids adding a callback prop through every intermediate component (CommandDeck,
// PlayTerminal, ThesisPanel) purely to carry a "switch tab" signal one level doesn't otherwise need.
export const NIGHTHAWK_GOTO_SWING_EVENT = "nighthawk:goto-swing";

export type NightHawkGotoSwingDetail = { ticker: string };

export function dispatchGotoSwing(ticker: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<NightHawkGotoSwingDetail>(NIGHTHAWK_GOTO_SWING_EVENT, { detail: { ticker } }),
  );
}
