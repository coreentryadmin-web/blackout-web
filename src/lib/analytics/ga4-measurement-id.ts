/** GA4 measurement ID — override via env for staging if needed. */
export const GA4_MEASUREMENT_ID =
  process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID?.trim() || "G-YLN4K37KYF";
