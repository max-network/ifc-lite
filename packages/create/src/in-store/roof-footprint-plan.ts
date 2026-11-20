/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The roof planes of a roof by footprint (#9296 round 3), as Revit's "Roof by
 * Footprint" and Archicad's multi-plane roof take one: a closed footprint and,
 * per edge, a slope or none.
 *
 * - A sloped edge is a pivot line: the roof's underside passes through it at the
 *   base elevation and rises inward at the edge's slope.
 * - An edge with no slope is a gable end (or the high side of a mono-pitch
 *   roof): the roof stops on a vertical plane above it.
 * - The overhang carries every edge out horizontally. Eaves drop with their
 *   plane; gable ends move out as a rake.
 *
 * Pure geometry in the caller's length unit. The planes come from the weighted
 * straight skeleton (`roof-skeleton.ts`) of the footprint; this module decides
 * which footprints it is trusted with (convex, rectilinear, or equal-pitch), and refuses the
 * rest with a reason instead of emitting a roof that is not one.
 */

import { weightedStraightSkeleton, type SkeletonLine, type SkeletonSpeedChange } from './roof-skeleton.js';

export type PlanPoint = [number, number];
export type RoofShapeType = 'FLAT_ROOF' | 'SHED_ROOF' | 'GABLE_ROOF' | 'HIP_ROOF' | 'HIPPED_GABLE_ROOF' | 'MANSARD_ROOF'
  | 'GAMBREL_ROOF' | 'PAVILION_ROOF' | 'FREEFORM';

/** Where an edge's slope changes: from `Height` above the eaves on, it rises at `Slope` (radians, 0 = vertical). */
export interface RoofEdgeBreak {
  readonly Height: number;
  readonly Slope: number;
}

/** Steeper than this is a wall, not a roof plane. */
export const MAX_ROOF_SLOPE = (85 * Math.PI) / 180;
/** A slope at or below this (radians) is no slope: a gable end. */
const NO_SLOPE = 1e-9;
/** No plane steeper than this (5°) is a flat roof with a fall, as IFC's FLAT_ROOF allows. */
const FLAT_FALL = (5 * Math.PI) / 180;

export interface RoofPlane {
  /** Index of the footprint edge this plane drains to, in the caller's order. */
  readonly edge: number;
  /** 0 for the plane rising from the edge, n for the plane above the edge's n-th break. */
  readonly stage: number;
  readonly slope: number;
  /** A point of the plane's pivot line at height 0 (the edge's start for stage 0) and the edge's unit direction. */
  readonly origin: PlanPoint;
  readonly direction: PlanPoint;
  /** The plane's underside outline in plan, counter-clockwise. Height at a point: `heightAt`. */
  readonly outline: PlanPoint[];
}

export interface FootprintRoofPlan {
  readonly shapeType: RoofShapeType;
  /** Sloped planes; empty for a flat roof. */
  readonly planes: RoofPlane[];
  /** The eave outline (footprint carried out by the overhang); the slab of a flat roof. */
  readonly eaves: PlanPoint[];
  /** Highest underside point above the base, in the caller's unit. */
  readonly rise: number;
}

const cross = (a: PlanPoint, b: PlanPoint) => a[0] * b[1] - a[1] * b[0];
const sub = (a: PlanPoint, b: PlanPoint): PlanPoint => [a[0] - b[0], a[1] - b[1]];

export function signedArea(points: readonly PlanPoint[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) sum += cross(points[i], points[(i + 1) % points.length]);
  return sum / 2;
}

/** Height of a plane's underside above the base at plan point `p`. */
export function heightAt(plane: Pick<RoofPlane, 'origin' | 'direction' | 'slope'>, p: PlanPoint): number {
  const inward = (p[0] - plane.origin[0]) * -plane.direction[1] + (p[1] - plane.origin[1]) * plane.direction[0];
  return Math.tan(plane.slope) * inward;
}

/**
 * The predefined type a footprint's slopes and breaks describe; `apex` when every
 * plane meets at one top point. With the edges' `directions`, any two opposed
 * sloped edges between gable ends are a gable roof, whatever the outline's count.
 */
export function roofShapeType(
  slopes: readonly number[], breaks: ReadonlyArray<readonly RoofEdgeBreak[]> = [], apex = false, directions?: readonly PlanPoint[],
): RoofShapeType {
  const sloped = slopes.map((a) => a > NO_SLOPE);
  const count = sloped.filter(Boolean).length;
  const turns = slopes.map((_, i) => breaks[i] ?? []);
  const steepest = Math.max(...slopes, ...turns.flat().map((b) => b.Slope));
  if (steepest <= NO_SLOPE || (steepest <= FLAT_FALL + NO_SLOPE && turns.every((t) => t.length === 0))) return 'FLAT_ROOF';
  if (turns.some((t, i) => !sloped[i] && t.some((b) => b.Slope > NO_SLOPE))) return 'HIPPED_GABLE_ROOF';
  if (turns.some((t, i) => sloped[i] && t.some((b) => b.Slope > NO_SLOPE))) return count === slopes.length ? 'MANSARD_ROOF' : 'GAMBREL_ROOF';
  if (count === slopes.length) return apex ? 'PAVILION_ROOF' : 'HIP_ROOF';
  if (count === 1) return 'SHED_ROOF';
  const pair = slopes.flatMap((_, i) => (sloped[i] ? [directions?.[i]] : []));
  const [a, b] = pair;
  if (count === 2 && a && b) return a[0] * b[0] + a[1] * b[1] < -1 + 1e-9 ? 'GABLE_ROOF' : 'FREEFORM';
  return slopes.length === 4 && count === 2 && sloped[0] === sloped[2] && sloped[1] === sloped[3]
    ? 'GABLE_ROOF' : 'FREEFORM';
}

function slopeError(index: number, value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return `EdgeSlopes[${index}] must be a finite angle in radians, 0 or more`;
  if (value > Math.PI / 2) {
    return `EdgeSlopes[${index}] is ${value}: slopes are radians (0 = gable end), so pass ${value}° as ${(value * Math.PI / 180).toFixed(6)}`;
  }
  if (value > MAX_ROOF_SLOPE) return `EdgeSlopes[${index}] is steeper than 85°, which is a wall rather than a roof plane`;
  return null;
}

interface Footprint { points: PlanPoint[]; slopes: number[]; breaks: RoofEdgeBreak[][]; edges: number[] }

function breaksError(index: number, value: readonly RoofEdgeBreak[]): string | null {
  let below = 0;
  for (const [j, item] of value.entries()) {
    if (typeof item.Height !== 'number' || !Number.isFinite(item.Height) || item.Height <= below) {
      return `EdgeBreaks[${index}][${j}].Height must be above the eaves and above the break before it`;
    }
    const error = slopeError(index, item.Slope);
    if (error) return error.replace(`EdgeSlopes[${index}]`, `EdgeBreaks[${index}][${j}].Slope`);
    below = item.Height;
  }
  return null;
}

/** Points closer than this, relative to the outline's size, are one point. */
const SAME_POINT = 1e-9;

/** The footprint without a repeated closing point: one point per edge start. */
export function openFootprint(outline: ReadonlyArray<readonly [number, number]>): PlanPoint[] {
  const points = outline.map((p) => [p[0], p[1]] as PlanPoint);
  if (points.length < 2) return points;
  const size = Math.max(...points.map((p) => Math.hypot(p[0] - points[0][0], p[1] - points[0][1])), 1e-12);
  const closed = points.length > 3 && Math.hypot(...sub(points[0], points[points.length - 1])) <= SAME_POINT * size;
  return closed ? points.slice(0, -1) : points;
}

/** Closed, simple, counter-clockwise, with collinear runs of one slope merged. Edge ids map back to the caller's order. */
function normaliseFootprint(outline: ReadonlyArray<readonly [number, number]>, slopes: readonly number[], edgeBreaks?: ReadonlyArray<readonly RoofEdgeBreak[]>): Footprint {
  if (outline.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) throw new Error('The footprint has a non-finite point');
  let points = openFootprint(outline);
  const size = Math.max(...points.map((p) => Math.hypot(p[0] - points[0][0], p[1] - points[0][1])), 1e-12);
  const tol = SAME_POINT * size;
  const n = points.length;
  if (n < 3) throw new Error('The footprint needs at least three points');
  if (slopes.length !== n) throw new Error(`EdgeSlopes needs one slope per footprint edge (edge i runs from point i to point i+1): the footprint has ${n} edges, EdgeSlopes has ${slopes.length}`);
  slopes.forEach((a, i) => { const error = slopeError(i, a); if (error) throw new Error(error); });
  if (edgeBreaks !== undefined && (!Array.isArray(edgeBreaks) || edgeBreaks.length !== n || edgeBreaks.some((t) => !Array.isArray(t)))) {
    throw new Error(`EdgeBreaks needs one list of { Height, Slope } per footprint edge (empty for none): the footprint has ${n} edges`);
  }
  const given: ReadonlyArray<readonly RoofEdgeBreak[]> = edgeBreaks ?? [];
  const turns = points.map((_, i): RoofEdgeBreak[] => (given[i] ?? []).map((b) => ({ Height: b.Height, Slope: b.Slope })));
  turns.forEach((t, i) => { const error = breaksError(i, t); if (error) throw new Error(error); });
  for (let i = 0; i < n; i++) {
    if (Math.hypot(...sub(points[(i + 1) % n], points[i])) <= tol) throw new Error(`Footprint edge ${i} has no length`);
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsMeet(points[i], points[(i + 1) % n], points[j], points[(j + 1) % n], tol)) {
        throw new Error(`The footprint crosses itself (edges ${i} and ${j})`);
      }
    }
  }
  if (Math.abs(signedArea(points)) <= tol * size) throw new Error('The footprint encloses no area');
  let edges = points.map((_, i) => i);
  let s = [...slopes];
  let br = turns;
  if (signedArea(points) < 0) {
    // Reversed, edge j runs over the caller's edge n-2-j backwards.
    points = points.reverse();
    edges = edges.map((_, j) => (2 * n - 2 - j) % n);
    s = edges.map((e) => slopes[e]);
    br = edges.map((e) => turns[e]);
  }
  // A point on a straight run splits one edge in two; with one slope it is still one edge.
  for (let i = 0; i < points.length && points.length > 3;) {
    const m = points.length, prev = points[(i + m - 1) % m], next = points[(i + 1) % m];
    const a = unit(sub(points[i], prev)), b = unit(sub(next, points[i]));
    if (Math.abs(cross(a, b)) > 1e-9) { i++; continue; }
    if (a[0] * b[0] + a[1] * b[1] < 0) throw new Error('The footprint doubles back on itself');
    const before = (i + m - 1) % m;
    if (Math.abs(s[before] - s[i]) > 1e-12 || JSON.stringify(br[before]) !== JSON.stringify(br[i])) {
      throw new Error(`Footprint edges ${edges[before]} and ${edges[i]} are in line but have different slopes`);
    }
    points.splice(i, 1); s.splice(i, 1); edges.splice(i, 1); br.splice(i, 1);
  }
  return { points, slopes: s, breaks: br, edges };
}

function unit(v: PlanPoint): PlanPoint {
  const length = Math.hypot(v[0], v[1]);
  return [v[0] / length, v[1] / length];
}

function segmentsMeet(a: PlanPoint, b: PlanPoint, c: PlanPoint, d: PlanPoint, tol: number): boolean {
  const d1 = cross(sub(b, a), sub(c, a)), d2 = cross(sub(b, a), sub(d, a));
  const d3 = cross(sub(d, c), sub(a, c)), d4 = cross(sub(d, c), sub(b, c));
  if (((d1 > tol && d2 < -tol) || (d1 < -tol && d2 > tol)) && ((d3 > tol && d4 < -tol) || (d3 < -tol && d4 > tol))) return true;
  const on = (p: PlanPoint, q: PlanPoint, r: PlanPoint) => Math.abs(cross(sub(q, p), sub(r, p))) <= tol * Math.hypot(...sub(q, p))
    && Math.min(p[0], q[0]) - tol <= r[0] && r[0] <= Math.max(p[0], q[0]) + tol && Math.min(p[1], q[1]) - tol <= r[1] && r[1] <= Math.max(p[1], q[1]) + tol;
  return on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b);
}

/** Keep the part of `polygon` where `n·p >= k`. */
function clip(polygon: readonly PlanPoint[], n: PlanPoint, k: number): PlanPoint[] {
  const out: PlanPoint[] = [];
  const side = (p: PlanPoint) => n[0] * p[0] + n[1] * p[1] - k;
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i], q = polygon[(i + 1) % polygon.length], sp = side(p), sq = side(q);
    if (sp >= 0) out.push(p);
    if ((sp >= 0) !== (sq >= 0)) {
      const t = sp / (sp - sq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}

/**
 * Plan a roof by footprint: lengths in one unit, slopes in radians (0 = no slope).
 * `breaks[i]` turns edge i to another slope at a height above the eaves: a gable
 * end that turns sloped is a half-hip, a slope that turns shallower a mansard.
 * Throws with a reason for a footprint or overhang it cannot roof correctly.
 */
export function planFootprintRoof(
  outline: ReadonlyArray<readonly [number, number]>,
  slopes: readonly number[],
  overhang: number,
  breaks?: ReadonlyArray<readonly RoofEdgeBreak[]>,
): FootprintRoofPlan {
  if (!Number.isFinite(overhang) || overhang < 0) throw new Error('Overhang must be a finite length, 0 or more');
  const { points, slopes: s, breaks: turns, edges } = normaliseFootprint(outline, slopes, breaks);
  const turning = turns.some((t) => t.length > 0);
  const n = points.length;
  const dirs = points.map((p, i) => unit(sub(points[(i + 1) % n], p)));
  const normals = dirs.map((d): PlanPoint => [-d[1], d[0]]);
  const pivots = points.map((p, i) => normals[i][0] * p[0] + normals[i][1] * p[1]);
  const reflex = points.map((_, i) => cross(dirs[(i + n - 1) % n], dirs[i]) < -1e-12);
  const rectilinear = dirs.every((d) => Math.abs(cross(d, dirs[0])) < 1e-9 || Math.abs(d[0] * dirs[0][0] + d[1] * dirs[0][1]) < 1e-9);
  const equalPitch = s.every(slope => Math.abs(slope - s[0]) < 1e-9);
  if (reflex.some(Boolean) && !rectilinear && (!equalPitch || turning)) {
    throw new Error('Roofs by footprint support convex and rectilinear footprints, or equal pitches at arbitrary inside corners');
  }

  const eaves = linesOutline(normals.map((nm, i) => ({ nx: nm[0], ny: nm[1], k: pivots[i] - overhang, s: 0 })), dirs, overhang);
  const sloped = s.map((a) => a > NO_SLOPE);
  // Named from the footprint as roofed: a straight run split in two is one edge.
  const rising = turns.map((t, i) => sloped[i] || t.some((b) => b.Slope > NO_SLOPE));
  if (!rising.some(Boolean)) return { shapeType: roofShapeType(s, turns), planes: [], eaves, rise: 0 };
  if (!sloped.some(Boolean)) throw new Error('A roof whose every edge starts as a gable end has no plane rising from its eaves');

  // The skeleton starts at the lowest eave; every line is where its plane is at that height.
  const steepest = Math.max(...s.filter((_, i) => sloped[i]).map(Math.tan));
  const start = -overhang * steepest;
  if (overhang > 0) {
    reflex.forEach((isReflex, i) => {
      const pair = [(i + n - 1) % n, i];
      if (isReflex && pair.some((e) => sloped[e] && Math.abs(Math.tan(s[e]) - steepest) > 1e-9 * steepest)) {
        throw new Error(`With an overhang, the edges at an inside corner need the roof's steepest slope (edges ${edges[pair[0]]} and ${edges[pair[1]]})`);
      }
    });
  }
  const lines: SkeletonLine[] = normals.map((nm, i) => sloped[i]
    ? { nx: nm[0], ny: nm[1], k: pivots[i] + start / Math.tan(s[i]), s: 1 / Math.tan(s[i]) }
    : { nx: nm[0], ny: nm[1], k: pivots[i] - overhang, s: 0 });
  linesOutline(lines, dirs, overhang);
  const speed = (slope: number) => (slope > NO_SLOPE ? 1 / Math.tan(slope) : 0);
  const changes = turns.flatMap((t, i) => t.map((b, j) => ({ line: i, at: b.Height - start, s: speed(b.Slope), stage: j + 1, slope: b.Slope })));
  const faces = weightedStraightSkeleton(lines, changes);

  const planes: RoofPlane[] = [];
  let rise = 0;
  for (let i = 0; i < n; i++) {
    if (!sloped[i]) continue;
    let outlinePlan = faces[i].map(([x, y]) => [x, y] as PlanPoint);
    if (overhang > 0) {
      // Below its own eave a plane is gone; at a convex corner so is the neighbour's.
      outlinePlan = clip(outlinePlan, normals[i], pivots[i] - overhang);
      if (!reflex[i]) outlinePlan = clip(outlinePlan, normals[(i + n - 1) % n], pivots[(i + n - 1) % n] - overhang);
      if (!reflex[(i + 1) % n]) outlinePlan = clip(outlinePlan, normals[(i + 1) % n], pivots[(i + 1) % n] - overhang);
    }
    if (outlinePlan.length < 3 || signedArea(outlinePlan) <= 1e-12 * Math.abs(signedArea(points))) continue;
    const plane: RoofPlane = { edge: edges[i], stage: 0, slope: s[i], origin: points[i], direction: dirs[i], outline: outlinePlan };
    for (const p of outlinePlan) rise = Math.max(rise, heightAt(plane, p));
    planes.push(plane);
  }
  const lineAt = new Map<number, SkeletonLine>();
  changes.forEach((change, j) => {
    const before = lineAt.get(change.line) ?? lines[change.line];
    const line = { ...before, k: before.k + (before.s - change.s) * change.at, s: change.s };
    lineAt.set(change.line, line);
    const outlinePlan = faces[n + j].map(([x, y]) => [x, y] as PlanPoint);
    if (change.slope <= NO_SLOPE || outlinePlan.length < 3 || signedArea(outlinePlan) <= 1e-12 * Math.abs(signedArea(points))) return;
    const i = change.line, shift = line.k - line.s * start - pivots[i];
    const origin: PlanPoint = [points[i][0] + normals[i][0] * shift, points[i][1] + normals[i][1] * shift];
    const plane: RoofPlane = { edge: edges[i], stage: change.stage, slope: change.slope, origin, direction: dirs[i], outline: outlinePlan };
    for (const p of outlinePlan) rise = Math.max(rise, heightAt(plane, p));
    planes.push(plane);
  });
  // Refuse a truncated wavefront rather than exporting an uncovered roof.
  const tiled = planes.reduce((area, plane) => area + signedArea(plane.outline), 0);
  const expected = signedArea(eaves);
  if (Math.abs(tiled - expected) > 1e-7 * Math.abs(expected)) {
    throw new Error('The roof planes do not cover the eaves; this footprint is not supported');
  }
  return { shapeType: roofShapeType(s, turns, oneApex(planes, rise), dirs), planes, eaves, rise };
}

/** Every plane reaches the roof's top at one and the same point: a pyramid. */
function oneApex(planes: readonly RoofPlane[], rise: number): boolean {
  const top = planes.flatMap((plane) => plane.outline.filter((p) => heightAt(plane, p) >= rise - 1e-9 * Math.max(1, rise)));
  if (top.length === 0) return false;
  const size = Math.max(1, ...planes.flatMap((plane) => plane.outline.map((p) => Math.hypot(p[0] - top[0][0], p[1] - top[0][1]))));
  const atApex = (p: PlanPoint) => Math.hypot(p[0] - top[0][0], p[1] - top[0][1]) <= 1e-7 * size;
  return top.every(atApex) && planes.every((plane) => plane.outline.some(atApex));
}

/** The polygon of consecutive line meets at τ = 0, refused when the overhang turns an edge round or crosses the outline. */
function linesOutline(lines: readonly SkeletonLine[], dirs: readonly PlanPoint[], overhang: number): PlanPoint[] {
  const n = lines.length;
  const corners = lines.map((line, i) => {
    const prev = lines[(i + n - 1) % n];
    const det = prev.nx * line.ny - prev.ny * line.nx;
    return [(prev.k * line.ny - prev.ny * line.k) / det, (prev.nx * line.k - prev.k * line.nx) / det] as PlanPoint;
  });
  const tooLarge = () => new Error(`Overhang ${overhang} is too large for this footprint: the eaves would cross`);
  for (let i = 0; i < n; i++) {
    const v = sub(corners[(i + 1) % n], corners[i]);
    if (v[0] * dirs[i][0] + v[1] * dirs[i][1] <= 0) throw tooLarge();
  }
  const size = Math.max(...corners.map((p) => Math.hypot(...sub(p, corners[0]))));
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsMeet(corners[i], corners[(i + 1) % n], corners[j], corners[(j + 1) % n], 1e-9 * size)) throw tooLarge();
    }
  }
  return corners;
}

/** A plane part's Tag: its footprint edge, then `.stage` for a plane above one of the edge's breaks. */
export function roofPlaneTag(plane: Pick<RoofPlane, 'edge'> & { readonly stage?: number }): string {
  return plane.stage ? `${plane.edge}.${plane.stage}` : String(plane.edge);
}
