import { cache as reactCache } from "react";

/**
 * React.cache in RSC; identity in tsx --test where react.cache is undefined (CJS interop).
 * Same rationale as clerk-user-cache.ts — unit tests import auth-server without the RSC runtime.
 */
export function requestCache<T extends (...args: never[]) => unknown>(fn: T): T {
  return typeof reactCache === "function" ? reactCache(fn) : fn;
}
