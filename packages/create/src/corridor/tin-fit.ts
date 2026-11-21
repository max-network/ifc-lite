/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { TinMesh } from './tin-mesh.js';

export type TinPoint = readonly [number, number, number];
export type TinTriangle = readonly [number, number, number];

/** A triangulated surface: points (x, y, z) and 0-based triangles. */
export interface Tin {
  points: TinPoint[];
  triangles: TinTriangle[];
}

export interface TinFitOptions {
  /** Points and edges closer than this are one, in the TIN's length unit. */
  epsilon?: number;
}

type PlanXY = readonly [number, number];

const DEFAULT_EPSILON = 1e-7;
const FLIP_BUDGET = 64;

interface Cut {
  t: number;
  point: TinPoint;
}

function lerp(a: TinPoint, b: TinPoint, t: number): TinPoint {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function crossing(a: TinPoint, b: TinPoint, c: readonly [number, number], d: readonly [number, number]): number | null {
  const rx = b[0] - a[0];
  const ry = b[1] - a[1];
  const sx = d[0] - c[0];
  const sy = d[1] - c[1];
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-15) return null;
  const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / denom;
  const u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / denom;
  return t > 0 && t < 1 && u >= 0 && u <= 1 ? t : null;
}

function boundaryEdges(mesh: TinMesh): [number, number][] {
  const edges: [number, number][] = [];
  for (const tri of mesh.liveTriangles()) {
    for (let k = 0; k < 3; k++) {
      const [a, b] = [tri[k], tri[(k + 1) % 3]];
      if (mesh.leftOf(b, a) === undefined) edges.push([a, b]);
    }
  }
  return edges;
}

function insideLoop(loop: readonly TinPoint[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const [xi, yi] = loop[i];
    const [xj, yj] = loop[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Each outline edge split where it crosses the TIN's boundary or another outline, so every piece lies wholly in or out of the TIN. */
function splitOutlines(mesh: TinMesh, outlines: readonly (readonly TinPoint[])[]): TinPoint[][][] {
  const border = boundaryEdges(mesh).map(([a, b]): [PlanXY, PlanXY] => [[mesh.xs[a], mesh.ys[a]], [mesh.xs[b], mesh.ys[b]]]);
  const edges = outlines.map((loop) => loop.map((a, k): [TinPoint, TinPoint] => [a, loop[(k + 1) % loop.length]]));
  return edges.map((loop, li) => loop.map(([a, b]) => {
    const cuts: Cut[] = [];
    for (const [c, d] of border) {
      const t = crossing(a, b, c, d);
      if (t !== null) cuts.push({ t, point: lerp(a, b, t) });
    }
    edges.forEach((other, oi) => {
      if (oi === li) return;
      for (const [c, d] of other) {
        const t = crossing(a, b, [c[0], c[1]], [d[0], d[1]]);
        if (t !== null) cuts.push({ t, point: lerp(a, b, t) });
      }
    });
    cuts.sort((p, q) => p.t - q.t);
    return [a, ...cuts.map((cut) => cut.point), b];
  }));
}

class Fitter {
  readonly heights = new Map<number, number>();

  constructor(readonly mesh: TinMesh) {}

  vertexAt(point: TinPoint): number | null {
    const at = this.mesh.locate(point[0], point[1]);
    if (!at) return null;
    const v = this.mesh.insert(point[0], point[1], point[2], at);
    this.heights.set(v, point[2]);
    return v;
  }

  private between(u: number, w: number): number | null {
    const { mesh } = this;
    const [ux, uy, wx, wy] = [mesh.xs[u], mesh.ys[u], mesh.xs[w], mesh.ys[w]];
    const length = Math.hypot(wx - ux, wy - uy);
    let best: { v: number; t: number } | null = null;
    for (const id of mesh.near(Math.min(ux, wx), Math.min(uy, wy), Math.max(ux, wx), Math.max(uy, wy))) {
      for (const v of mesh.triangles[id] ?? []) {
        if (v === u || v === w) continue;
        const t = ((mesh.xs[v] - ux) * (wx - ux) + (mesh.ys[v] - uy) * (wy - uy)) / (length * length);
        if (t <= 0 || t >= 1) continue;
        if (Math.abs(mesh.orientAt(u, w, mesh.xs[v], mesh.ys[v])) / length > mesh.eps) continue;
        if (!best || t < best.t) best = { v, t };
      }
    }
    return best?.v ?? null;
  }

  private crossedEdges(u: number, w: number): [number, number][] {
    const { mesh } = this;
    const seen = new Set<string>();
    const out: [number, number][] = [];
    const [ux, uy, wx, wy] = [mesh.xs[u], mesh.ys[u], mesh.xs[w], mesh.ys[w]];
    for (const id of mesh.near(Math.min(ux, wx), Math.min(uy, wy), Math.max(ux, wx), Math.max(uy, wy))) {
      const tri = mesh.triangles[id];
      if (!tri) continue;
      for (let k = 0; k < 3; k++) {
        const [p, q] = [tri[k], tri[(k + 1) % 3]];
        const name = p < q ? `${p},${q}` : `${q},${p}`;
        if (seen.has(name)) continue;
        seen.add(name);
        if (this.properlyCrosses(u, w, p, q)) out.push([p, q]);
      }
    }
    return out;
  }

  private properlyCrosses(u: number, w: number, p: number, q: number): boolean {
    if (p === u || p === w || q === u || q === w) return false;
    const { mesh } = this;
    return mesh.orient(u, w, p) * mesh.orient(u, w, q) < 0 && mesh.orient(p, q, u) * mesh.orient(p, q, w) < 0;
  }

  /** Make u–w an edge: split it at any vertex lying on it, then flip the edges it crosses away (Sloan). */
  recover(u: number, w: number): void {
    const { mesh } = this;
    const zu = this.heights.get(u) ?? mesh.zs[u];
    const zw = this.heights.get(w) ?? mesh.zs[w];
    const pending: [number, number, number, number][] = [[u, w, zu, zw]];
    while (pending.length > 0) {
      const next = pending.pop();
      if (!next) break;
      const [a, b, za, zb] = next;
      if (a === b || mesh.hasEdge(a, b)) continue;
      const on = this.between(a, b);
      if (on !== null) {
        const t = Math.hypot(mesh.xs[on] - mesh.xs[a], mesh.ys[on] - mesh.ys[a]) / Math.hypot(mesh.xs[b] - mesh.xs[a], mesh.ys[b] - mesh.ys[a]);
        const zOn = za + (zb - za) * t;
        this.heights.set(on, zOn);
        pending.push([a, on, za, zOn], [on, b, zOn, zb]);
        continue;
      }
      const queue = this.crossedEdges(a, b);
      let budget = FLIP_BUDGET * (queue.length + 1) * (queue.length + 1);
      while (queue.length > 0) {
        if (budget-- <= 0) throw new Error('fitTinToOutlines: an outline edge could not be recovered');
        const edge = queue.shift();
        if (!edge) break;
        const flipped = mesh.flip(edge[0], edge[1]);
        if (!flipped) {
          queue.push(edge);
          continue;
        }
        if (this.properlyCrosses(a, b, flipped[0], flipped[1])) queue.push([flipped[0], flipped[1]]);
      }
    }
  }
}

function compact(source: Tin, mesh: TinMesh, heights: ReadonlyMap<number, number>, keep: (tri: TinTriangle) => boolean): Tin {
  const points: TinPoint[] = [...source.points];
  const remap = new Map<number, number>();
  const index = (v: number): number => {
    const known = remap.get(v);
    if (known !== undefined) return known;
    const z = heights.get(v) ?? mesh.zs[v];
    const unchanged = v < source.points.length && z === source.points[v][2];
    const out = unchanged ? v : points.push([mesh.xs[v], mesh.ys[v], z]) - 1;
    remap.set(v, out);
    return out;
  };
  const triangles = mesh.liveTriangles().filter(keep).map(([a, b, c]): TinTriangle => [index(a), index(b), index(c)]);
  return { points, triangles };
}

/**
 * The TIN with every outline cut into it: the outline edges become TIN
 * edges at the outline's heights, and what lies inside an outline is
 * removed. Source points keep their index and height; new and re-heighted
 * points are appended, so the TIN stays one conforming C0 surface that
 * meets each outline with no gap and no step.
 */
export function fitTinToOutlines(source: Tin, outlines: readonly (readonly TinPoint[])[], options: TinFitOptions = {}): Tin {
  if (outlines.length === 0 || source.triangles.length === 0) return { points: [...source.points], triangles: [...source.triangles] };
  const mesh = new TinMesh(source.points, source.triangles, options.epsilon ?? DEFAULT_EPSILON);
  const fitter = new Fitter(mesh);
  const constraints: [number, number][] = [];
  for (const loop of splitOutlines(mesh, outlines)) {
    for (const pieces of loop) {
      for (let k = 0; k + 1 < pieces.length; k++) {
        const [p, q] = [pieces[k], pieces[k + 1]];
        if (!mesh.locate((p[0] + q[0]) / 2, (p[1] + q[1]) / 2)) continue;
        const a = fitter.vertexAt(p);
        const b = fitter.vertexAt(q);
        if (a !== null && b !== null && a !== b) constraints.push([a, b]);
      }
    }
  }
  for (const [a, b] of constraints) fitter.recover(a, b);
  const removed = ([a, b, c]: TinTriangle) => {
    const x = (mesh.xs[a] + mesh.xs[b] + mesh.xs[c]) / 3;
    const y = (mesh.ys[a] + mesh.ys[b] + mesh.ys[c]) / 3;
    return outlines.some((loop) => insideLoop(loop, x, y));
  };
  return compact(source, mesh, fitter.heights, (tri) => !removed(tri));
}
