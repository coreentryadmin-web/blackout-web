/** Google Search Console HTML-tag verification token (Admin → Ownership verification). */
export function googleSiteVerificationToken(): string | undefined {
  const token =
    process.env.GOOGLE_SITE_VERIFICATION?.trim() ||
    process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION?.trim();
  return token || undefined;
}

export const INDEXNOW_KEY = "a1522e9c3ec34cf57a2f7ce063981593";

export const INDEXNOW_KEY_URL = `https://blackouttrades.com/${INDEXNOW_KEY}.txt`;
