/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { Drawing2D, Point2D } from '../../types.js';
import type { LocalSegment, ScanAxis } from './interior.js';

const OBSTACLE = /^Ifc(Stair|Ramp|Railing|Furnishing|Furniture|SystemFurniture|SanitaryTerminal|FlowTerminal|ElectricAppliance|Transport)/i;

/** Stairs, ramps, railings, furniture and fixtures: what interior chains keep clear of by default. */
export const isPlanObstacle = (ifcType: string): boolean => OBSTACLE.test(ifcType) && !/type$/i.test(ifcType);

/** The drawn plan geometry of every obstacle element (visible and hidden lines, cut outlines), in the local frame. */
export function obstacleSegments(
  drawing: Partial<Pick<Drawing2D, 'lines' | 'cutPolygons'>>,
  keep: (ifcType: string) => boolean,
  toLocal: (p: Point2D) => Point2D,
): LocalSegment[] {
  const segments: LocalSegment[] = [];
  for (const line of drawing.lines ?? []) {
    if (keep(line.ifcType)) segments.push([toLocal(line.line.start), toLocal(line.line.end)]);
  }
  for (const cut of drawing.cutPolygons ?? []) {
    if (!keep(cut.ifcType)) continue;
    for (const ring of [cut.polygon.outer, ...cut.polygon.holes]) {
      ring.forEach((p, i) => segments.push([toLocal(p), toLocal(ring[(i + 1) % ring.length])]));
    }
  }
  return segments;
}

function crossesBox(segment: LocalSegment, x0: number, y0: number, x1: number, y1: number): boolean {
  const [p, q] = segment;
  let t0 = 0;
  let t1 = 1;
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const edges: [number, number][] = [[-dx, p.x - x0], [dx, x1 - p.x], [-dy, p.y - y0], [dy, y1 - p.y]];
  for (const [step, room] of edges) {
    if (Math.abs(step) < 1e-12) {
      if (room < 0) return false;
      continue;
    }
    const t = room / step;
    if (step < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}

/** Whether no obstacle segment enters the box. */
export function boxClear(obstacles: readonly LocalSegment[], x0: number, y0: number, x1: number, y1: number): boolean {
  return !obstacles.some((segment) => crossesBox(segment, x0, y0, x1, y1));
}

function touching(obstacles: readonly LocalSegment[], axis: ScanAxis, at: number, lo: number, hi: number, band: number): number {
  const box: [number, number, number, number] = axis === 'u' ? [lo, at - band, hi, at + band] : [at - band, lo, at + band, hi];
  return obstacles.filter((segment) => crossesBox(segment, ...box)).length;
}

/** How badly a chain along `axis` at `at`, spanning `lo`..`hi`, meets obstacles: segments its line crosses first, then those inside its text band. 0 is clear. */
export function chainCrossings(obstacles: readonly LocalSegment[], axis: ScanAxis, at: number, lo: number, hi: number, band: number): number {
  return touching(obstacles, axis, at, lo, hi, 0) * (obstacles.length + 1) + touching(obstacles, axis, at, lo, hi, band);
}
