/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { HorizontalSegment } from '../landxml/alignment-mapping.js';
import type { VerticalSegment } from '../landxml/profile-geometry.js';

export const DEFAULT_CORRIDOR_TOLERANCE = 0.005;
export const DEFAULT_MAX_STATIONS = 2000;
const BOUNDARY_EPS = 1e-9;
const RELAX = 2;

/** Arc length whose chord stays within `tolerance` of a circle of `radius`: sagitta r(1 − cos(Δθ/2)) = tolerance. */
export function arcStep(radius: number, tolerance: number): number {
  if (tolerance >= radius) return Math.PI * radius;
  return 2 * radius * Math.acos(1 - tolerance / radius);
}

/** Horizontal step whose chord stays within `tolerance` of a parabola of length L: |Δg|·Δx²/(8L) = tolerance. */
export function parabolaStep(length: number, gradeChange: number, tolerance: number): number {
  if (gradeChange === 0) return Infinity;
  return Math.sqrt((8 * length * tolerance) / Math.abs(gradeChange));
}

export interface StationOptions {
  /** Largest distance of any surface point from the centreline: the arc bound is kept at this offset. */
  maxOffset: number;
  tolerance?: number;
  maxStations?: number;
}

interface Piece {
  from: number;
  to: number;
  step: (tolerance: number) => number;
}

function horizontalPieces(segments: readonly HorizontalSegment[], maxOffset: number): Piece[] {
  let start = 0;
  return segments.map((segment) => {
    const from = start;
    start += segment.length;
    const curvature = Math.max(Math.abs(segment.startCurvature), Math.abs(segment.endCurvature));
    const step = segment.type !== 'LINE' && curvature > 0 ? (t: number) => arcStep(1 / curvature + maxOffset, t) : () => Infinity;
    return { from, to: start, step };
  });
}

function verticalPieces(segments: readonly VerticalSegment[]): Piece[] {
  return segments.map((segment) => ({
    from: segment.startDistAlong,
    to: segment.startDistAlong + segment.horizontalLength,
    step: segment.type === 'CONSTANTGRADIENT' ? () => Infinity : (t: number) => parabolaStep(segment.horizontalLength, segment.endGradient - segment.startGradient, t),
  }));
}

function boundaries(pieces: readonly Piece[], length: number): number[] {
  const values = [0, length, ...pieces.flatMap((p) => [p.from, p.to])].filter((s) => s >= 0 && s <= length).sort((a, b) => a - b);
  return values.filter((s, i) => i === 0 || s - values[i - 1] > BOUNDARY_EPS);
}

function stationsAt(pieces: readonly Piece[], marks: readonly number[], tolerance: number): number[] {
  const stations = [marks[0]];
  marks.slice(1).forEach((to, i) => {
    const from = marks[i];
    const mid = (from + to) / 2;
    const step = Math.min(...pieces.filter((p) => p.from <= mid && mid <= p.to).map((p) => p.step(tolerance)));
    const count = Number.isFinite(step) ? Math.max(1, Math.ceil((to - from) / step - 1e-12)) : 1;
    for (let k = 1; k < count; k++) stations.push(from + ((to - from) * k) / count);
    stations.push(to);
  });
  return stations;
}

/**
 * Stations for a corridor mesh: every horizontal and vertical segment
 * boundary, with arcs subdivided so the sagitta at the outermost offset and
 * vertical curves subdivided so the parabola's chord deviation both stay
 * within the tolerance. When that needs more than `maxStations`, the
 * tolerance is relaxed until it does not, and the tolerance kept is returned.
 */
export function corridorStations(
  horizontal: readonly HorizontalSegment[], vertical: readonly VerticalSegment[], length: number, options: StationOptions,
): { stations: number[]; tolerance: number } {
  const pieces = [...horizontalPieces(horizontal, options.maxOffset), ...verticalPieces(vertical)];
  const marks = boundaries(pieces, length);
  const maxStations = Math.max(options.maxStations ?? DEFAULT_MAX_STATIONS, marks.length);
  let tolerance = options.tolerance ?? DEFAULT_CORRIDOR_TOLERANCE;
  let stations = stationsAt(pieces, marks, tolerance);
  while (stations.length > maxStations) {
    tolerance *= RELAX;
    stations = stationsAt(pieces, marks, tolerance);
  }
  return { stations, tolerance };
}
