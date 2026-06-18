export type VixTermSnapshot = {
  vix9d: number | null;
  vix3m: number | null;
  structure: "contango" | "backwardation" | "flat" | "unknown";
  detail: string;
  /** True when near-term (VIX9D) is missing but 3M data was used. */
  partial?: boolean;
};

export function computeVixTermStructure(
  spot: number | null,
  near: number | null,
  far: number | null
): VixTermSnapshot {
  if (spot == null) {
    return { vix9d: near, vix3m: far, structure: "unknown", detail: "Insufficient VIX term data" };
  }
  if (near == null && far == null) {
    return { vix9d: null, vix3m: null, structure: "unknown", detail: "Insufficient VIX term data" };
  }
  const spreadNear = near != null ? near - spot : far != null ? far - spot : 0;
  if (near == null && far != null) {
    const spreadFar = far - spot;
    if (spreadFar > 0.5) {
      return {
        vix9d: null,
        vix3m: far,
        structure: "contango",
        detail: `Contango (3M only) +${spreadFar.toFixed(2)}`,
        partial: true,
      };
    }
    if (spreadFar < -0.5) {
      return {
        vix9d: null,
        vix3m: far,
        structure: "backwardation",
        detail: `Backwardation (3M only) ${spreadFar.toFixed(2)}`,
        partial: true,
      };
    }
    return { vix9d: null, vix3m: far, structure: "flat", detail: "Flat term (3M only)", partial: true };
  }
  if (far != null) {
    const spreadFar = far - spot;
    if (spreadNear > 0.5 && spreadFar > spreadNear) {
      return {
        vix9d: near,
        vix3m: far,
        structure: "contango",
        detail: `Contango — near +${spreadNear.toFixed(2)}, far +${spreadFar.toFixed(2)}`,
      };
    }
    if (spreadNear < -0.5) {
      return {
        vix9d: near,
        vix3m: far,
        structure: "backwardation",
        detail: `Backwardation — front below spot`,
      };
    }
    return { vix9d: near, vix3m: far, structure: "flat", detail: `Flat — spot ${spot.toFixed(2)}` };
  }
  if (spreadNear > 0.5) {
    return { vix9d: near, vix3m: far, structure: "contango", detail: `Contango +${spreadNear.toFixed(2)}` };
  }
  if (spreadNear < -0.5) {
    return { vix9d: near, vix3m: far, structure: "backwardation", detail: `Backwardation ${spreadNear.toFixed(2)}` };
  }
  return { vix9d: near, vix3m: far, structure: "flat", detail: `Flat term` };
}
