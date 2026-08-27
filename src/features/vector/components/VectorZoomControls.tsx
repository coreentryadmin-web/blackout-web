"use client";

type Props = {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  /** When false, omit data-testid (compact toolbar row duplicates desktop controls in DOM). */
  exposeTestIds?: boolean;
};

/**
 * Explicit zoom in / zoom out / reset buttons for the standalone chart toolbar (member request,
 * 2026-08-27: "add better user controls for zoom in, zoom out, drag, move, scroll"). Mouse-wheel
 * and click-drag zoom/pan already work — this is a discoverable, deliberate on-screen control for
 * members who don't reach for those gestures (trackpad quirks, a member who never tried scrolling
 * on the chart at all). Handlers live in VectorChart (stepZoom/handleZoomReset) so button clicks
 * go through the exact same visible-logical-range + viewport-lock bookkeeping as a wheel tick.
 */
export function VectorZoomControls({ onZoomIn, onZoomOut, onReset, exposeTestIds = true }: Props) {
  return (
    <div className="vector-desk-seg vector-zoom-controls" role="group" aria-label="Chart zoom">
      <button
        type="button"
        title="Zoom out"
        aria-label="Zoom out"
        onClick={onZoomOut}
        {...(exposeTestIds ? { "data-testid": "vector-zoom-out" } : {})}
        className="vector-desk-seg-btn vector-zoom-btn"
      >
        −
      </button>
      <button
        type="button"
        title="Reset zoom"
        aria-label="Reset zoom"
        onClick={onReset}
        {...(exposeTestIds ? { "data-testid": "vector-zoom-reset" } : {})}
        className="vector-desk-seg-btn vector-zoom-btn vector-zoom-reset-btn"
      >
        ⟲
      </button>
      <button
        type="button"
        title="Zoom in"
        aria-label="Zoom in"
        onClick={onZoomIn}
        {...(exposeTestIds ? { "data-testid": "vector-zoom-in" } : {})}
        className="vector-desk-seg-btn vector-zoom-btn"
      >
        +
      </button>
    </div>
  );
}
