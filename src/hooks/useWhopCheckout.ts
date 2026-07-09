"use client";

import { useEffect, useState } from "react";

type CheckoutUrls = {
  monthly: string;
  yearly: string;
  lifetime: string;
  store: string;
};

type CheckoutPayload = {
  checkout: CheckoutUrls;
  options: { label: string; href: string }[];
  configured: boolean;
};

const EMPTY: CheckoutPayload = {
  checkout: { monthly: "", yearly: "", lifetime: "", store: "" },
  options: [],
  configured: false,
};

export function useWhopCheckout() {
  const [data, setData] = useState<CheckoutPayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/public/checkout-urls", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : EMPTY))
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch(() => {
        if (!cancelled) setData(EMPTY);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return data;
}
