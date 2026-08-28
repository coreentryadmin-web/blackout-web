import Link from "next/link";
import { auth } from "@/lib/auth-server";
import { SyncMembershipButton } from "@/components/SyncMembershipButton";

const SIGN_IN_SYNC_HREF = "/sign-in?redirect_url=%2Fupgrade";

/**
 * Server-rendered gate for /upgrade — anonymous visitors ALWAYS get the sign-in
 * link in the initial HTML (no Clerk hydration flash exposing "I paid — refresh
 * my access"). Signed-in members get the interactive sync button under Clerk.
 */
export async function SyncMembershipSection() {
  const { userId } = await auth();
  if (!userId) {
    return (
      <Link href={SIGN_IN_SYNC_HREF} className="btn-outline-bull">
        Sign in to sync purchase
      </Link>
    );
  }
  return <SyncMembershipButton />;
}

export { SIGN_IN_SYNC_HREF };
