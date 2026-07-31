"use client";

import { clsx } from "clsx";
import { useIosNativeShell } from "@/hooks/useIosNativeShell";

type Props = {
  children: React.ReactNode;
};

/** Account settings — native scroll + safe-area padding on iOS shell. */
export function AccountPageShell({ children }: Props) {
  const nativeShell = useIosNativeShell();

  return (
    <main
      className={clsx(
        "ios-account-page ios-native-page ios-native-page-account min-h-screen flex flex-col items-center",
        nativeShell ? "ios-account-page-native px-3" : "px-4"
      )}
    >
      <div className={clsx("w-full max-w-4xl", nativeShell && "ios-account-scroll")}>{children}</div>
    </main>
  );
}
