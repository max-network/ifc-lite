/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { DrawingPolygon, Point2D } from './types.js';

/**
 * Simplify polygon by removing collinear points
 */
export function simplifyPolygon(points: Point2D[], tolerance: number = 0.001): Point2D[] {
  if (points.length < 3) return points;

  const result: Point2D[] = [];

  for (let i = 0; i < points.length; i++) {
    const prev = points[(i - 1 + points.length) % points.length];
    const curr = points[i];
    const next = points[(i + 1) % points.length];

    // Check if current point is on the line between prev and next
    if (!isCollinear(prev, curr, next, tolerance)) {
      result.push(curr);
    }
  }

  return result.length >= 3 ? result : points;
}

/**
 * Check if three points are collinear
 */
function isCollinear(a: Point2D, b: Point2D, c: Point2D, tolerance: number): boolean {
  // Area of triangle formed by the three points
  const area = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y));
  return area < tolerance;
}

/**
 * Compute polygon bounds
 */
export function polygonBounds(
  points: Point2D[]
): { min: Point2D; max: Point2D } {
  let minX = Infinity,
    minY = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity;

  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }

  return {
    min: { x: minX, y: minY },
    max: { x: maxX, y: maxY },
  };
}

/**
 * Drop ring vertices that lie on the straight edge between their neighbours.
 *
 * A planar cut through a triangulated face yields one segment per triangle, so a
 * straight wall face comes back as several collinear segments, split wherever a
 * tessellation edge crosses the cut plane. Those vertices carry no shape, but a
 * consumer that snaps to ring vertices (2D measure) lands on them. A vertex is
 * dropped only when it sits within `tolerance` of the chord from the last kept
 * vertex to the next one AND strictly between them, so corners, spikes and
 * backtracks stay. `points` is an implicitly closed ring; fewer than three
 * surviving vertices returns the input unchanged.
 */
export function removeCollinearRingVertices(points: Point2D[], tolerance: number): Point2D[] {
  const n = points.length;
  if (n < 4) return points;
  const onChord = (a: Point2D, b: Point2D, c: Point2D): boolean => {
    const dx = c.x - a.x, dy = c.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return false;
    const t = ((b.x - a.x) * dx + (b.y - a.y) * dy) / len2;
    if (t <= 0 || t >= 1) return false;
    const cross = (b.x - a.x) * dy - (b.y - a.y) * dx;
    return cross * cross <= tolerance * tolerance * len2;
  };
  // Start from a vertex that is certainly kept, so the wrap-around is exact.
  let start = -1;
  for (let i = 0; i < n; i++) {
    if (!onChord(points[(i - 1 + n) % n], points[i], points[(i + 1) % n])) { start = i; break; }
  }
  if (start < 0) return points; // every vertex collinear: degenerate, leave as is
  const kept: Point2D[] = [points[start]];
  for (let k = 1; k < n; k++) {
    const curr = points[(start + k) % n];
    const next = points[(start + k + 1) % n];
    if (!onChord(kept[kept.length - 1], curr, next)) kept.push(curr);
  }
  return kept.length >= 3 ? kept : points;
}

/**
 * Area-weighted centroid of an element's cut fragments, holes subtracted, or
 * null when they enclose no area. Every fragment contributes, so tessellation
 * order cannot move the point.
 */
export function polygonsAreaCentroid(polygons: readonly DrawingPolygon[]): Point2D | null {
  let area = 0, x = 0, y = 0;
  for (const { polygon } of polygons) {
    for (const [ringIndex, ring] of [polygon.outer, ...polygon.holes].entries()) {
      let a = 0, cx = 0, cy = 0;
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i], q = ring[(i + 1) % ring.length];
        const cross = p.x * q.y - q.x * p.y;
        a += cross; cx += (p.x + q.x) * cross; cy += (p.y + q.y) * cross;
      }
      if (Math.abs(a) < 1e-12) continue;
      const weight = Math.abs(a) * (ringIndex === 0 ? 1 : -1);
      x += (cx / (3 * a)) * weight; y += (cy / (3 * a)) * weight; area += weight;
    }
  }
  return area > 1e-12 ? { x: x / area, y: y / area } : null;
}
