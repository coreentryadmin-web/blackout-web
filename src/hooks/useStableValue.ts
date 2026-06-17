import { useEffect, useRef } from "react";

/** Keep the last non-empty/non-null value across refreshes so UI does not flash away. */
export function useStableArray<T>(value: T[]) {
  const ref = useRef<T[]>([]);
  useEffect(() => {
    if (value.length > 0) ref.current = value;
  }, [value]);
  return value.length > 0 ? value : ref.current;
}

export function useStableValue<T>(value: T | null | undefined, isValid: (v: T | null | undefined) => boolean) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    if (isValid(value)) ref.current = value as T;
  }, [value, isValid]);
  return isValid(value) ? (value as T) : ref.current;
}
