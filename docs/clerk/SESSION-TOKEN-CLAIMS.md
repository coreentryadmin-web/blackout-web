# Clerk session token claims

BlackOut reads **`tier`** and **`role`** from the Clerk session JWT when present, falling back to `users.getUser()` when not configured.

## Dashboard setup (one-time)

1. Open [Clerk Dashboard](https://dashboard.clerk.com) → **Configure** → **Sessions**
2. **Customize session token**
3. Merge this JSON into the claims editor:

```json
{
  "tier": "{{user.public_metadata.tier}}",
  "role": "{{user.public_metadata.role}}"
}
```

4. Save

## Verify

```bash
npm run validate:clerk-config
```

Expect **JWT tier claim** and **JWT role claim** → PASS after Dashboard save (new sign-ins pick it up immediately; existing sessions refresh within ~60s).

## Apply redirect URLs (API)

```bash
npm run clerk:recommendations-apply
```

Adds production redirect URLs idempotently via the Clerk Backend API.

## Code

- `src/lib/clerk-session-claims.ts` — parse claims
- `src/lib/tier-cache.ts` — `resolveUserTier(userId, sessionClaims?)`
- `src/lib/admin-access.ts` — `isAdminUser(userId, sessionClaims?)`
- `src/types/clerk-session.d.ts` — `CustomJwtSessionClaims` typing

After a Whop upgrade or admin tier change, users should **Sign out / Sign in** or hit **Sync membership** (calls `session.reload()`) for an immediate JWT refresh.
