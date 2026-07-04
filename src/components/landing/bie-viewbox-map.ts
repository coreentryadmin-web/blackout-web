/** Map SVG viewBox coordinates to pixel positions inside a container (matches preserveAspectRatio slice). */
export function viewBoxPointToContainer(
  vx: number,
  vy: number,
  containerW: number,
  containerH: number,
  viewW: number,
  viewH: number,
  mode: "slice" | "meet" = "slice"
): { x: number; y: number; scale: number } {
  const scale =
    mode === "slice"
      ? Math.max(containerW / viewW, containerH / viewH)
      : Math.min(containerW / viewW, containerH / viewH);
  const offsetX = (containerW - viewW * scale) / 2;
  const offsetY = (containerH - viewH * scale) / 2;
  return {
    x: offsetX + vx * scale,
    y: offsetY + vy * scale,
    scale,
  };
}
