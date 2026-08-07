declare global {
  interface Window {
    twq?: (...args: unknown[]) => void;
  }
}

const X_PIXEL_ID = "re1j3";

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

export function xPixelAvailable(): boolean {
  return isBrowser() && typeof window.twq === "function";
}

export function trackXEvent(
  eventId: string,
  params?: Record<string, string | number>,
): void {
  if (!xPixelAvailable()) return;
  if (params) {
    window.twq!("event", eventId, params);
  } else {
    window.twq!("event", eventId);
  }
}

export { X_PIXEL_ID };
