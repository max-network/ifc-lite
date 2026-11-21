/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export type Location =
  | { kind: 'vertex'; vertex: number }
  | { kind: 'edge'; a: number; b: number }
  | { kind: 'inside'; triangle: number };

const key = (a: number, b: number): string => `${a},${b}`;

/** A planar triangulation that can take new points and flip edges; triangles are kept counter-clockwise. */
export class TinMesh {
  readonly xs: number[] = [];
  readonly ys: number[] = [];
  readonly zs: number[] = [];
  readonly triangles: (readonly [number, number, number] | null)[] = [];
  private readonly halfEdges = new Map<string, number>();
  private readonly around = new Map<number, Set<number>>();
  private readonly cells = new Map<string, number[]>();
  private readonly cellSize: number;
  readonly eps: number;

  constructor(points: readonly (readonly [number, number, number])[], triangles: readonly (readonly [number, number, number])[], eps: number) {
    this.eps = eps;
    for (const [x, y, z] of points) this.addVertex(x, y, z);
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), eps);
    this.cellSize = Math.max(span / Math.max(1, Math.sqrt(triangles.length)), eps * 1e3);
    for (const [a, b, c] of triangles) this.addTriangle(a, b, c);
  }

  addVertex(x: number, y: number, z: number): number {
    this.xs.push(x);
    this.ys.push(y);
    this.zs.push(z);
    return this.xs.length - 1;
  }

  orient(a: number, b: number, c: number): number {
    return (this.xs[b] - this.xs[a]) * (this.ys[c] - this.ys[a]) - (this.ys[b] - this.ys[a]) * (this.xs[c] - this.xs[a]);
  }

  orientAt(a: number, b: number, x: number, y: number): number {
    return (this.xs[b] - this.xs[a]) * (y - this.ys[a]) - (this.ys[b] - this.ys[a]) * (x - this.xs[a]);
  }

  private cellRange(minX: number, minY: number, maxX: number, maxY: number): string[] {
    const out: string[] = [];
    const s = this.cellSize;
    for (let i = Math.floor(minX / s); i <= Math.floor(maxX / s); i++) {
      for (let j = Math.floor(minY / s); j <= Math.floor(maxY / s); j++) out.push(`${i}:${j}`);
    }
    return out;
  }

  addTriangle(a: number, b: number, c: number): number {
    const tri: [number, number, number] = this.orient(a, b, c) >= 0 ? [a, b, c] : [a, c, b];
    const id = this.triangles.length;
    this.triangles.push(tri);
    for (let k = 0; k < 3; k++) {
      this.halfEdges.set(key(tri[k], tri[(k + 1) % 3]), id);
      const set = this.around.get(tri[k]) ?? new Set<number>();
      set.add(id);
      this.around.set(tri[k], set);
    }
    const txs = tri.map((v) => this.xs[v]);
    const tys = tri.map((v) => this.ys[v]);
    for (const cell of this.cellRange(Math.min(...txs), Math.min(...tys), Math.max(...txs), Math.max(...tys))) {
      const list = this.cells.get(cell) ?? [];
      list.push(id);
      this.cells.set(cell, list);
    }
    return id;
  }

  removeTriangle(id: number): void {
    const tri = this.triangles[id];
    if (!tri) return;
    this.triangles[id] = null;
    for (let k = 0; k < 3; k++) {
      const edge = key(tri[k], tri[(k + 1) % 3]);
      if (this.halfEdges.get(edge) === id) this.halfEdges.delete(edge);
      this.around.get(tri[k])?.delete(id);
    }
  }

  /** The triangle on the left of the directed edge a→b. */
  leftOf(a: number, b: number): number | undefined {
    return this.halfEdges.get(key(a, b));
  }

  hasEdge(a: number, b: number): boolean {
    return this.halfEdges.has(key(a, b)) || this.halfEdges.has(key(b, a));
  }

  isBoundary(a: number, b: number): boolean {
    return this.halfEdges.has(key(a, b)) !== this.halfEdges.has(key(b, a));
  }

  /** Living triangles whose bounding boxes meet the given box. */
  near(minX: number, minY: number, maxX: number, maxY: number): number[] {
    const found = new Set<number>();
    const pad = this.eps;
    for (const cell of this.cellRange(minX - pad, minY - pad, maxX + pad, maxY + pad)) {
      for (const id of this.cells.get(cell) ?? []) if (this.triangles[id]) found.add(id);
    }
    return [...found];
  }

  private distanceToEdge(a: number, b: number, x: number, y: number): number {
    const length = Math.hypot(this.xs[b] - this.xs[a], this.ys[b] - this.ys[a]);
    return Math.abs(this.orientAt(a, b, x, y)) / length;
  }

  locate(x: number, y: number): Location | null {
    for (const id of this.near(x, y, x, y)) {
      const tri = this.triangles[id];
      if (!tri) continue;
      for (const v of tri) if (Math.hypot(this.xs[v] - x, this.ys[v] - y) <= this.eps) return { kind: 'vertex', vertex: v };
    }
    for (const id of this.near(x, y, x, y)) {
      const tri = this.triangles[id];
      if (!tri) continue;
      const sides = [0, 1, 2].map((k) => this.distanceToEdge(tri[k], tri[(k + 1) % 3], x, y) * Math.sign(this.orientAt(tri[k], tri[(k + 1) % 3], x, y)));
      if (sides.some((d) => d < -this.eps)) continue;
      const onEdge = sides.findIndex((d) => d <= this.eps);
      if (onEdge >= 0) return { kind: 'edge', a: tri[onEdge], b: tri[(onEdge + 1) % 3] };
      return { kind: 'inside', triangle: id };
    }
    return null;
  }

  /** Insert a point where `locate` found it; returns the vertex there, new or old. */
  insert(x: number, y: number, z: number, at: Location): number {
    if (at.kind === 'vertex') return at.vertex;
    const p = this.addVertex(x, y, z);
    if (at.kind === 'inside') {
      const tri = this.triangles[at.triangle];
      if (!tri) throw new Error('TinMesh.insert: stale triangle');
      const [a, b, c] = tri;
      this.removeTriangle(at.triangle);
      this.addTriangle(a, b, p);
      this.addTriangle(b, c, p);
      this.addTriangle(c, a, p);
      return p;
    }
    for (const [u, w] of [[at.a, at.b], [at.b, at.a]]) {
      const id = this.leftOf(u, w);
      const tri = id === undefined ? null : this.triangles[id];
      if (id === undefined || !tri) continue;
      const apex = tri.find((v) => v !== u && v !== w);
      if (apex === undefined) continue;
      this.removeTriangle(id);
      this.addTriangle(u, p, apex);
      this.addTriangle(p, w, apex);
    }
    return p;
  }

  /** Flip the diagonal a–b of the quad its two triangles form, when the quad is strictly convex. */
  flip(a: number, b: number): readonly [number, number] | null {
    const left = this.leftOf(a, b);
    const right = this.leftOf(b, a);
    if (left === undefined || right === undefined) return null;
    const c = this.triangles[left]?.find((v) => v !== a && v !== b);
    const d = this.triangles[right]?.find((v) => v !== a && v !== b);
    if (c === undefined || d === undefined) return null;
    if (!(this.orient(a, d, c) > 0 && this.orient(d, b, c) > 0)) return null;
    this.removeTriangle(left);
    this.removeTriangle(right);
    this.addTriangle(a, d, c);
    this.addTriangle(d, b, c);
    return [c, d];
  }

  liveTriangles(): (readonly [number, number, number])[] {
    return this.triangles.filter((t): t is readonly [number, number, number] => t !== null);
  }
}
