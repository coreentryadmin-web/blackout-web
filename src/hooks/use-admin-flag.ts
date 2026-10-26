"use client";

import { useEffect } from "react";
import useSWR from "swr";
import { useAppAuth } from "@/lib/auth-client";

type AdminMeResponse = { admin?: boolean };

const fetchAdminMe = async (url: string): Promise<AdminMeResponse> => {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return { admin: false };
  return res.json() as Promise<AdminMeResponse>;
};

/** Reads the cached admin flag. SSR/private-mode/blocked-storage safe — storage access can throw
 * a SecurityError (sandboxed embed, "Block All Cookies") and every other storage read in this repo
 * degrades to a safe default on that rather than crashing; this one didn't, so it's brought in line. */
export function readSessionAdminFlag(userId: string | null | undefined): boolean | null {
  if (!userId || typeof sessionStorage === "undefined") return null;
  try {
    const cached = sessionStorage.getItem(`__admin_flag:${userId}`);
    if (cached === null) return null;
    return cached === "1";
  } catch {
    return null;
  }
}

/** Persists the cached admin flag. Silent no-op on SSR / blocked storage — best effort only. */
export function writeSessionAdminFlag(userId: string, admin: boolean): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(`__admin_flag:${userId}`, admin ? "1" : "0");
  } catch {
    /* quota / private-mode / blocked storage — best effort */
  }
}

/** Shared admin flag — one SWR poll for Nav + iOS chrome (was duplicate fetch per mount). */
export function useAdminFlag(): boolean {
  const { isSignedIn, isLoaded, userId } = useAppAuth();
  const sessionHint = readSessionAdminFlag(userId);
  const { data } = useSWR<AdminMeResponse>(
    isLoaded && isSignedIn && userId ? "/api/admin/me" : null,
    fetchAdminMe,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60_000,
      fallbackData: sessionHint === null ? undefined : { admin: sessionHint },
    }
  );

  useEffect(() => {
    if (!userId || !data) return;
    writeSessionAdminFlag(userId, Boolean(data.admin));
  }, [userId, data]);

  if (!isLoaded || !isSignedIn) return false;
  if (data) return Boolean(data.admin);
  return sessionHint ?? false;
}
