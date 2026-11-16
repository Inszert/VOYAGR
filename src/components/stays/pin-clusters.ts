/**
 * Pins that would sit on top of each other become one cluster.
 *
 * The pins on the stays map are real buttons, so MapLibre's own clustering -
 * which draws circles on the canvas - cannot be used: a canvas circle cannot
 * be tabbed to or read. This is the same idea in screen space: greedy, in
 * list order (cheapest priced stays first), each pin joining the first
 * cluster within `radius` pixels of it. Pure, so it is tested without a map.
 */
export interface ScreenPin {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

export interface PinCluster {
  /** The first member's id: stable while the view is. */
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly members: readonly string[];
}

export function clusterPins(pins: readonly ScreenPin[], radius: number): PinCluster[] {
  const clusters: { id: string; x: number; y: number; members: string[] }[] = [];

  for (const pin of pins) {
    const near = clusters.find(
      (cluster) => Math.hypot(cluster.x - pin.x, cluster.y - pin.y) <= radius,
    );
    if (near) near.members.push(pin.id);
    else clusters.push({ id: pin.id, x: pin.x, y: pin.y, members: [pin.id] });
  }

  return clusters;
}
