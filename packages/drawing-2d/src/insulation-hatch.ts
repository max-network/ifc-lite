/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { Line2D, Point2D } from './types.js';
import { EPSILON } from './math.js';

export interface LayerBand {
  origin: Point2D;
  along: Point2D;
  across: Point2D;
  length: number;
  thickness: number;
}

export const INSULATION_LEG_PITCH = 0.5;

const cross = (o: Point2D, a: Point2D, b: Point2D): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

function hull(points: readonly Point2D[]): Point2D[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length < 3) return sorted;
  const half = (input: readonly Point2D[]): Point2D[] => {
    const out: Point2D[] = [];
    for (const p of input) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

export function layerBand(ring: readonly Point2D[]): LayerBand | null {
  const corners = hull(ring);
  let best: LayerBand | null = null;
  let narrowest = Infinity;
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    const size = Math.hypot(b.x - a.x, b.y - a.y);
    if (size < EPSILON) continue;
    const along = { x: (b.x - a.x) / size, y: (b.y - a.y) / size };
    const across = { x: -along.y, y: along.x };
    let [minA, maxA, minC, maxC] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const p of corners) {
      const u = p.x * along.x + p.y * along.y;
      const v = p.x * across.x + p.y * across.y;
      [minA, maxA, minC, maxC] = [Math.min(minA, u), Math.max(maxA, u), Math.min(minC, v), Math.max(maxC, v)];
    }
    const thickness = maxC - minC;
    if (thickness >= narrowest) continue;
    narrowest = thickness;
    const length = maxA - minA;
    const [longAxis, shortAxis, longSize, shortSize, longMin, shortMin] =
      length >= thickness ? [along, across, length, thickness, minA, minC] : [across, along, thickness, length, minC, minA];
    best = {
      origin: { x: longAxis.x * longMin + shortAxis.x * shortMin, y: longAxis.y * longMin + shortAxis.y * shortMin },
      along: longAxis,
      across: shortAxis,
      length: longSize,
      thickness: shortSize,
    };
  }
  return best !== null && best.thickness > EPSILON && best.length > EPSILON ? best : null;
}

export function insulationZigzag(ring: readonly Point2D[], pitch: number = INSULATION_LEG_PITCH): Line2D[] {
  const band = layerBand(ring);
  if (band === null) return [];
  const legs = Math.max(1, Math.round(band.length / (band.thickness * pitch)));
  const step = band.length / legs;
  const at = (i: number): Point2D => {
    const side = i % 2 === 0 ? 0 : band.thickness;
    return { x: band.origin.x + band.along.x * step * i + band.across.x * side, y: band.origin.y + band.along.y * step * i + band.across.y * side };
  };
  return Array.from({ length: legs }, (_, i) => ({ start: at(i), end: at(i + 1) }));
}
