/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The terrain of a vertical view. The terrain's edges and its cut by the
 * picture plane are projected like any line and classified against the
 * building; the visible pieces give the terrain's upper outline, and building
 * lines below that outline and not in front of it are in the ground.
 */

import type { MeshData } from '@ifc-lite/geometry';
import type { DrawingLine, Point2D, SectionPlaneConfig, Vec3 } from '../types.js';
import { vec3, vec3Lerp } from '../math.js';
import { projectPointForPlane, signedDepth } from '../projection-bands.js';
import { SectionCutter } from '../section-cutter.js';

const HEIGHT_TOLERANCE = 0.005;
const DEPTH_TOLERANCE = 0.05;
const COLLINEAR = 1e-4;

/** An extent along the drawing's x axis, metres. */
export interface Range {
  min: number;
  max: number;
}

function vertexOf(mesh: MeshData, index: number): Vec3 {
  const o = mesh.origin ?? [0, 0, 0];
  return vec3(mesh.positions[index * 3] + o[0], mesh.positions[index * 3 + 1] + o[1], mesh.positions[index * 3 + 2] + o[2]);
}

function clipTo(line: DrawingLine, range: Range): DrawingLine | null {
  const { start, end } = line.line;
  const lo = Math.min(start.x, end.x);
  const hi = Math.max(start.x, end.x);
  if (hi < range.min || lo > range.max) return null;
  if (lo >= range.min && hi <= range.max) return line;
  const dx = end.x - start.x;
  const [t0, t1] = [(range.min - start.x) / dx, (range.max - start.x) / dx].map((t) => Math.min(1, Math.max(0, t))).sort((a, b) => a - b);
  const depthEnd = line.depthEnd ?? line.depth;
  const point = (t: number): Point2D => ({ x: start.x + dx * t, y: start.y + (end.y - start.y) * t });
  return { ...line, line: { start: point(t0), end: point(t1) }, depth: line.depth + (depthEnd - line.depth) * t0, depthEnd: line.depth + (depthEnd - line.depth) * t1 };
}

function edgeLine(mesh: MeshData, p: Vec3, q: Vec3, plane: SectionPlaneConfig, viewDepth: number): DrawingLine | null {
  const dp = -signedDepth(p, plane);
  const dq = -signedDepth(q, plane);
  if (Math.max(dp, dq) < 0 || Math.min(dp, dq) > viewDepth) return null;
  const span = dq - dp;
  const clamp = (t: number) => Math.max(0, Math.min(1, t));
  const [t0, t1] = span === 0 ? [0, 1] : [clamp((0 - dp) / span), clamp((viewDepth - dp) / span)].sort((a, b) => a - b);
  const start = vec3Lerp(p, q, t0);
  const end = vec3Lerp(p, q, t1);
  return {
    line: { start: projectPointForPlane(start, plane), end: projectPointForPlane(end, plane) },
    category: 'projection',
    visibility: 'visible',
    entityId: mesh.expressId,
    ifcType: mesh.ifcType ?? 'Unknown',
    modelIndex: mesh.modelIndex ?? 0,
    depth: -signedDepth(start, plane),
    depthEnd: -signedDepth(end, plane),
  };
}

/** The terrain meshes' triangle edges in the window `[0, viewDepth]` behind the plane and within `range` along it, projected with their view depths. */
export function terrainEdges(meshes: readonly MeshData[], plane: SectionPlaneConfig, viewDepth: number, range: Range): DrawingLine[] {
  const lines: DrawingLine[] = [];
  for (const mesh of meshes) {
    const seen = new Set<number>();
    const count = mesh.positions.length / 3;
    for (let i = 0; i + 2 < mesh.indices.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const a = mesh.indices[i + k];
        const b = mesh.indices[i + ((k + 1) % 3)];
        const key = Math.min(a, b) * count + Math.max(a, b);
        if (seen.has(key)) continue;
        seen.add(key);
        const line = edgeLine(mesh, vertexOf(mesh, a), vertexOf(mesh, b), plane, viewDepth);
        const clipped = line && clipTo(line, range);
        if (clipped) lines.push(clipped);
      }
    }
  }
  return lines;
}

/** The terrain cut by the plane itself, at view depth 0, within `range`. */
export function terrainCut(meshes: readonly MeshData[], plane: SectionPlaneConfig, range: Range): DrawingLine[] {
  if (meshes.length === 0) return [];
  const { segments } = new SectionCutter(plane).cutMeshes([...meshes]);
  return segments.flatMap((segment) => {
    const line: DrawingLine = { line: { start: segment.p0_2d, end: segment.p1_2d }, category: 'cut', visibility: 'visible', entityId: segment.entityId, ifcType: segment.ifcType, modelIndex: segment.modelIndex, depth: 0 };
    const clipped = clipTo(line, range);
    return clipped ? [clipped] : [];
  });
}

function simplify(points: readonly Point2D[]): Point2D[] {
  const kept: Point2D[] = [];
  for (const point of points) {
    const a = kept[kept.length - 2];
    const b = kept[kept.length - 1];
    const off = a && b ? Math.abs((b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)) : Infinity;
    if (a && b && off < COLLINEAR * Math.hypot(point.x - a.x, point.y - a.y)) kept[kept.length - 1] = point;
    else kept.push(point);
  }
  return kept;
}

/** The terrain's upper outline across a view, sampled every `step` along it: the highest visible terrain and how deep it lies there. */
export class TerrainOutline {
  private readonly heights: Float64Array;
  private readonly depths: Float64Array;

  constructor(
    pieces: readonly DrawingLine[],
    private readonly range: Range,
    private readonly step: number,
  ) {
    const count = Math.max(1, Math.floor((range.max - range.min) / step) + 1);
    this.heights = new Float64Array(count).fill(Number.NaN);
    this.depths = new Float64Array(count).fill(Number.NaN);
    for (const piece of pieces) this.add(piece);
  }

  private index(x: number): number {
    return Math.round((x - this.range.min) / this.step);
  }

  private keep(i: number, height: number, depth: number): void {
    if (i < 0 || i >= this.heights.length) return;
    const current = this.heights[i];
    if (Number.isNaN(current) || height > current + HEIGHT_TOLERANCE) {
      this.heights[i] = height;
      this.depths[i] = depth;
    } else if (height > current - HEIGHT_TOLERANCE) {
      this.heights[i] = Math.max(current, height);
      this.depths[i] = Math.min(this.depths[i], depth);
    }
  }

  private add(piece: DrawingLine): void {
    const { start, end } = piece.line;
    const depthEnd = piece.depthEnd ?? piece.depth;
    const from = this.index(Math.min(start.x, end.x));
    const to = this.index(Math.max(start.x, end.x));
    const dx = end.x - start.x;
    if (from === to || Math.abs(dx) < 1e-9) {
      const top = start.y >= end.y ? { y: start.y, depth: piece.depth } : { y: end.y, depth: depthEnd };
      for (let i = from; i <= to; i++) this.keep(i, top.y, top.depth);
      return;
    }
    for (let i = from; i <= to; i++) {
      const t = Math.max(0, Math.min(1, (this.range.min + i * this.step - start.x) / dx));
      this.keep(i, start.y + (end.y - start.y) * t, piece.depth + (depthEnd - piece.depth) * t);
    }
  }

  /** The outline as polylines, broken where no terrain is seen, collinear points dropped. */
  polylines(): Point2D[][] {
    const runs: Point2D[][] = [];
    let run: Point2D[] = [];
    this.heights.forEach((height, i) => {
      if (Number.isNaN(height)) {
        if (run.length > 1) runs.push(run);
        run = [];
        return;
      }
      run.push({ x: this.range.min + i * this.step, y: height });
    });
    if (run.length > 1) runs.push(run);
    return runs.map(simplify);
  }

  /** The outline's height at `x`, or null where no terrain is seen. */
  heightAt(x: number): number | null {
    const i = this.index(x);
    const height = i >= 0 && i < this.heights.length ? this.heights[i] : Number.NaN;
    return Number.isNaN(height) ? null : height;
  }

  private buriedAt(point: Point2D, depth: number): boolean {
    const i = this.index(point.x);
    if (i < 0 || i >= this.heights.length) return false;
    const height = this.heights[i];
    return !Number.isNaN(height) && point.y < height - HEIGHT_TOLERANCE && depth >= this.depths[i] - DEPTH_TOLERANCE;
  }

  /** `lines` with the parts in the ground marked hidden; cut lines lie in the plane and stay as they are. */
  bury(lines: readonly DrawingLine[]): DrawingLine[] {
    return lines.flatMap((line) => (line.category === 'cut' ? [line] : this.buryLine(line)));
  }

  private buryLine(line: DrawingLine): DrawingLine[] {
    const { start, end } = line.line;
    const samples = Math.max(1, Math.ceil(Math.hypot(end.x - start.x, end.y - start.y) / this.step));
    const depthEnd = line.depthEnd ?? line.depth;
    const depthAt = (t: number) => line.depth + (depthEnd - line.depth) * t;
    const pointAt = (t: number): Point2D => ({ x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t });
    const states = Array.from({ length: samples }, (_, k) => {
      const t = (k + 0.5) / samples;
      return this.buriedAt(pointAt(t), depthAt(t));
    });
    if (states.every((buried) => !buried)) return [line];
    const pieces: DrawingLine[] = [];
    let from = 0;
    for (let k = 1; k <= samples; k++) {
      if (k < samples && states[k] === states[from]) continue;
      const t0 = from / samples;
      const t1 = k / samples;
      pieces.push({ ...line, line: { start: pointAt(t0), end: pointAt(t1) }, visibility: states[from] ? 'hidden' : 'visible', depth: depthAt(t0), depthEnd: depthAt(t1) });
      from = k;
    }
    return pieces;
  }
}

/** The extent of `points` along the view, grown by `margin(width)` on both sides; null without points. */
export function alongRange(points: readonly Point2D[], margin: (width: number) => number): Range | null {
  if (points.length === 0) return null;
  const { min, max } = points.reduce((r, p) => ({ min: Math.min(r.min, p.x), max: Math.max(r.max, p.x) }), { min: Infinity, max: -Infinity });
  const grow = margin(max - min);
  return { min: min - grow, max: max + grow };
}
