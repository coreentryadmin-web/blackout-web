import type { VectorBoardSort, VectorBoardStatusFilter, VectorBoardTierFilter } from "@/features/nighthawk/lib/vector-board-filters";
import type { VectorClosureReasonFilter } from "@/features/nighthawk/lib/vector-pick-log-board-utils";

export type VectorBoardDensity = "comfortable" | "compact";
export type VectorBoardCalendarRange = "recent" | "all";

export type VectorBoardColumnId =
  | "pick"
  | "status"
  | "premium"
  | "entryMark"
  | "peak"
  | "path"
  | "updated";

export const VECTOR_BOARD_COLUMNS: { id: VectorBoardColumnId; label: string; default: boolean }[] = [
  { id: "pick", label: "Pick", default: true },
  { id: "status", label: "Status", default: true },
  { id: "premium", label: "Premium vs entry", default: true },
  { id: "entryMark", label: "Entry → mark", default: true },
  { id: "peak", label: "Peak", default: true },
  { id: "path", label: "Premium path", default: true },
  { id: "updated", label: "Updated", default: true },
];

export type VectorBoardSavedView = {
  id: string;
  name: string;
  statusFilter: VectorBoardStatusFilter;
  tierFilter: VectorBoardTierFilter;
  reasonFilter: VectorClosureReasonFilter;
  sort: VectorBoardSort;
};

export type VectorBoardPreferences = {
  density: VectorBoardDensity;
  columns: Record<VectorBoardColumnId, boolean>;
  calendarRange: VectorBoardCalendarRange;
  focusMode: boolean;
  savedViews: VectorBoardSavedView[];
};

const STORAGE_KEY = "nh-vector-board-prefs-v1";

const DEFAULT_COLUMNS = Object.fromEntries(
  VECTOR_BOARD_COLUMNS.map((c) => [c.id, c.default])
) as Record<VectorBoardColumnId, boolean>;

const DEFAULT_PREFS: VectorBoardPreferences = {
  density: "comfortable",
  columns: DEFAULT_COLUMNS,
  calendarRange: "recent",
  focusMode: false,
  savedViews: [
    {
      id: "today-winners",
      name: "Today's winners",
      statusFilter: "winner",
      tierFilter: "all",
      reasonFilter: "all",
      sort: "pnl_desc",
    },
    {
      id: "caution-only",
      name: "Caution picks",
      statusFilter: "caution",
      tierFilter: "all",
      reasonFilter: "all",
      sort: "updated_desc",
    },
    {
      id: "elite-runners",
      name: "Elite runners",
      statusFilter: "runner",
      tierFilter: "elite",
      reasonFilter: "all",
      sort: "pnl_desc",
    },
  ],
};

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function loadVectorBoardPreferences(): VectorBoardPreferences {
  if (!canUseStorage()) return DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<VectorBoardPreferences>;
    return {
      ...DEFAULT_PREFS,
      ...parsed,
      columns: { ...DEFAULT_COLUMNS, ...(parsed.columns ?? {}) },
      savedViews: parsed.savedViews?.length ? parsed.savedViews : DEFAULT_PREFS.savedViews,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function saveVectorBoardPreferences(prefs: VectorBoardPreferences): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* quota / private mode */
  }
}
