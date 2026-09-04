// Pure helpers for AuthFailureObserver.tsx — split out so the matching/dedup
// logic is unit-testable without a real DOM (no jsdom in this repo's test setup).

// Clerk's "elements" theming API (see clerk-theme.ts, already live in production —
// formFieldErrorText/alert are actively themed there) maps each key to a stable
// `cl-<key>` class on the rendered element. Clerk appends additional
// field-specific/hashed classes alongside it, so this is a substring check
// against the full className string, not an exact match.
const CLERK_ERROR_CLASS_MARKERS = ["cl-formFieldErrorText", "cl-alert"];

/** True if a rendered element's className string indicates it's one of Clerk's
 *  own error-display elements (never a form input, never a credential). */
export function isClerkErrorClassName(className: string): boolean {
  if (!className) return false;
  return CLERK_ERROR_CLASS_MARKERS.some((marker) => className.includes(marker));
}

export type LastReported = { message: string; at: number };

// Clerk can re-render the same error element more than once for a single failed
// attempt (e.g. a field-level error plus a top-level alert firing together) —
// this window collapses those into one beacon per real user action.
export const DEDUPE_WINDOW_MS = 3_000;

/** Clerk surfaces these as error UI on /sign-in but they are normal UX, not failed auth attempts. */
const BENIGN_CLERK_AUTH_MESSAGE_RES = [
  /already signed in/i,
  /sign[\s-]?in token has already been used/i,
  /each token can only be used once/i,
];

/** True when Clerk's visible error text is expected navigation state, not a credential failure. */
export function isBenignClerkAuthMessage(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return false;
  return BENIGN_CLERK_AUTH_MESSAGE_RES.some((re) => re.test(trimmed));
}

/** Pure: should this message be reported now, given what was last reported? */
export function shouldReportAuthFailure(message: string, lastReported: LastReported | null, now: number): boolean {
  const trimmed = message.trim();
  if (!trimmed) return false;
  if (isBenignClerkAuthMessage(trimmed)) return false;
  if (!lastReported) return true;
  if (lastReported.message === trimmed && now - lastReported.at < DEDUPE_WINDOW_MS) return false;
  return true;
}
