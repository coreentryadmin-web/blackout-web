/**
 * Clerk Dashboard → Sessions → Customize session token:
 *   "tier": "{{user.public_metadata.tier}}"
 *   "role": "{{user.public_metadata.role}}"
 */
export {};

declare global {
  interface CustomJwtSessionClaims {
    tier?: string;
    role?: string;
  }
}
