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

function readSessionAdminFlag(userId: string | null | undefined): boolean | null {
  if (!userId || typeof sessionStorage === "undefined") return null;
  const cached = sessionStorage.getItem(`__admin_flag:${userId}`);
  if (cached === null) return null;
  return cached === "1";
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
    sessionStorage.setItem(`__admin_flag:${userId}`, data.admin ? "1" : "0");
  }, [userId, data]);

  if (!isLoaded || !isSignedIn) return false;
  if (data) return Boolean(data.admin);
  return sessionHint ?? false;
}
