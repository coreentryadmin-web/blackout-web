import type { PostType } from "./x-content-types";

/** Even ET hours 8–20 = one post every 2 hours. */
export const POST_HOURS_ET = [8, 10, 12, 14, 16, 18, 20] as const;

const WEEKEND_POST_HOURS = [10, 14] as const;

const HOUR_TO_TYPE: Record<number, PostType> = {
  8: "desk_open",
  10: "desk_flow",
  12: "desk_ai",
  14: "desk_matrix",
  16: "desk_midday",
  18: "desk_close",
  20: "desk_evening",
};

export function isPostWindow(nowEt: Date): boolean {
  const h = nowEt.getHours();
  const dow = nowEt.getDay();
  if (dow === 0 || dow === 6) {
    return (WEEKEND_POST_HOURS as readonly number[]).includes(h);
  }
  return (POST_HOURS_ET as readonly number[]).includes(h);
}

export function selectPostType(nowEt: Date): PostType | null {
  if (!isPostWindow(nowEt)) return null;
  const h = nowEt.getHours();
  const dow = nowEt.getDay();
  if (dow === 0 || dow === 6) return "weekend_desk";
  return HOUR_TO_TYPE[h] ?? null;
}

export const SCHEDULE = POST_HOURS_ET.map((h) => ({
  type: HOUR_TO_TYPE[h]!,
  hours: [h, h + 2] as [number, number],
}));
