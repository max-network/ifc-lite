/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { Point2D } from '../../types.js';

/** A cut polygon in the local frame: outer ring first, then holes. */
export type LocalPolygon = readonly (readonly Point2D[])[];

export type ScanAxis = 'u' | 'v';

const JOIN = 2e-3;

function crossings(polygon: LocalPolygon, axis: ScanAxis, at: number): number[] {
  const along = axis === 'u' ? 'x' : 'y';
  const across = axis === 'u' ? 'y' : 'x';
  const hits: number[] = [];
  for (const ring of polygon) {
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i];
      const q = ring[(i + 1) % ring.length];
      if (p[across] > at === q[across] > at) continue;
      hits.push(p[along] + ((at - p[across]) * (q[along] - p[along])) / (q[across] - p[across]));
    }
  }
  return hits.sort((a, b) => a - b);
}

/** Where a scan line through the polygons runs inside material, merged across touching polygons. */
export function scanIntervals(polygons: readonly LocalPolygon[], axis: ScanAxis, at: number): [number, number][] {
  const intervals: [number, number][] = [];
  for (const polygon of polygons) {
    const hits = crossings(polygon, axis, at);
    for (let i = 0; i + 1 < hits.length; i += 2) if (hits[i + 1] - hits[i] > 1e-6) intervals.push([hits[i], hits[i + 1]]);
  }
  intervals.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const interval of intervals) {
    const last = merged[merged.length - 1];
    if (last && interval[0] <= last[1] + JOIN) last[1] = Math.max(last[1], interval[1]);
    else merged.push([interval[0], interval[1]]);
  }
  return merged;
}

export type LocalSegment = readonly [Point2D, Point2D];

const ADJACENT = 0.02;

export function outlineSpan(outline: readonly LocalSegment[], axis: ScanAxis, at: number, inside: number): [number, number] | undefined {
  const along = axis === 'u' ? 'x' : 'y';
  const across = axis === 'u' ? 'y' : 'x';
  const hits: number[] = [];
  for (const [p, q] of outline) {
    if (p[across] > at === q[across] > at) continue;
    hits.push(p[along] + ((at - p[across]) * (q[along] - p[along])) / (q[across] - p[across]));
  }
  const lo = Math.max(...hits.filter((h) => h < inside));
  const hi = Math.min(...hits.filter((h) => h > inside));
  return Number.isFinite(lo) && Number.isFinite(hi) ? [lo, hi] : undefined;
}

/** A room's clear span along a scan line: from its outline when given, else the gap between walls around `inside`. */
export function roomSpan(polygons: readonly LocalPolygon[], axis: ScanAxis, at: number, inside: number, outline: readonly LocalSegment[] = []): [number, number] | undefined {
  const span = outline.length > 0 ? outlineSpan(outline, axis, at, inside) : undefined;
  if (span) return span;
  const intervals = scanIntervals(polygons, axis, at);
  const k = intervals.findIndex((interval, i) => i + 1 < intervals.length && interval[1] < inside && intervals[i + 1][0] > inside);
  return k < 0 ? undefined : [intervals[k][1], intervals[k + 1][0]];
}

/** A room's chain along a scan line: its clear span plus each adjacent wall that is interior and not yet in `walls`. */
export function roomStations(polygons: readonly LocalPolygon[], axis: ScanAxis, at: number, inside: number, walls: Set<string>, outline: readonly LocalSegment[] = []): number[] {
  const span = roomSpan(polygons, axis, at, inside, outline);
  if (!span) return [];
  const intervals = scanIntervals(polygons, axis, at);
  const [lo, hi] = span;
  const claim = (index: number): [number, number] | undefined => {
    const wall = intervals[index];
    if (!wall || index === 0 || index === intervals.length - 1) return undefined;
    const key = `${axis}:${Math.round(wall[0] * 200)}:${Math.round(wall[1] * 200)}`;
    if (walls.has(key)) return undefined;
    walls.add(key);
    return wall;
  };
  const left = claim(intervals.findIndex((w) => Math.abs(w[1] - lo) <= ADJACENT));
  const right = claim(intervals.findIndex((w) => Math.abs(w[0] - hi) <= ADJACENT));
  return [...(left ? [left[0]] : []), lo, hi, ...(right ? [right[1]] : [])];
}
