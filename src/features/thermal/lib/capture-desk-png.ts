/** Client-only Thermal desk PNG export — captures the live DOM the member sees. */

export type ThermalCaptureView = "matrix" | "profile" | "depth" | "grid";

const FILENAME_SAFE = /[^a-z0-9._-]+/gi;

/** Deterministic local filename — no secrets, safe on all OSes. */
export function thermalCaptureFilename(opts: {
  ticker: string;
  lens: string;
  view: ThermalCaptureView;
  at?: Date;
}): string {
  const day = (opts.at ?? new Date()).toISOString().slice(0, 10);
  const ticker = opts.ticker.trim().toUpperCase().replace(FILENAME_SAFE, "") || "THERMAL";
  const lens = opts.lens.trim().toLowerCase().replace(FILENAME_SAFE, "") || "gex";
  const view = opts.view.replace(FILENAME_SAFE, "") || "matrix";
  return `thermal-${ticker}-${lens}-${view}-${day}.png`;
}

type StyleSnapshot = {
  el: HTMLElement;
  maxHeight: string;
  minHeight: string;
  overflow: string;
  height: string;
};

function expandScrollRegions(root: HTMLElement): StyleSnapshot[] {
  const snapshots: StyleSnapshot[] = [];
  root.querySelectorAll<HTMLElement>("[data-thermal-capture-expand]").forEach((el) => {
    snapshots.push({
      el,
      maxHeight: el.style.maxHeight,
      minHeight: el.style.minHeight,
      overflow: el.style.overflow,
      height: el.style.height,
    });
    el.style.maxHeight = "none";
    el.style.minHeight = "0";
    el.style.overflow = "visible";
    el.style.height = "auto";
  });
  return snapshots;
}

function restoreScrollRegions(snapshots: StyleSnapshot[]): void {
  for (const snap of snapshots) {
    snap.el.style.maxHeight = snap.maxHeight;
    snap.el.style.minHeight = snap.minHeight;
    snap.el.style.overflow = snap.overflow;
    snap.el.style.height = snap.height;
  }
}

/**
 * Rasterize `root` to PNG and trigger a browser download on the member's machine.
 * Scroll boxes marked `data-thermal-capture-expand` are fully expanded for the shot.
 */
export async function downloadElementPng(root: HTMLElement, filename: string): Promise<void> {
  const { toPng } = await import("html-to-image");
  const expanded = expandScrollRegions(root);

  try {
    const dataUrl = await toPng(root, {
      pixelRatio: 2,
      cacheBust: true,
      filter: (node) => {
        if (node instanceof HTMLElement && node.dataset.thermalCaptureHide !== undefined) {
          return false;
        }
        return true;
      },
    });

    const link = document.createElement("a");
    link.download = filename;
    link.href = dataUrl;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    restoreScrollRegions(expanded);
  }
}
