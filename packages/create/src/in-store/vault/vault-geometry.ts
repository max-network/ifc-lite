/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { KERNEL_MIN_ARC_CHORDS, archArcs, archHeightAt, archSampleOffsets, archShape, type ArchShape } from '../arch/arch-shape.js';
import { withoutRepeats, type PathSegment, type ProfilePath, type Pt2 } from '../arch/profile-path.js';

export type Vec3 = [number, number, number];

export interface FaceSet {
  readonly coords: Vec3[];
  readonly faces: number[][];
}

const ZERO = 1e-12;

function point(arch: ArchShape, x: number, offset: number): Pt2 {
  return [x, archHeightAt(arch, x, offset) ?? 0];
}

function arcs(arch: ArchShape, offset: number, tolerance: number, fromX: number, toX: number): PathSegment[] {
  return archArcs(arch, offset, fromX, toX, tolerance, KERNEL_MIN_ARC_CHORDS).map(({ via, to }): PathSegment => ({ kind: 'arc', via, to }));
}

export function barrelProfile(span: number, rise: number, thickness: number, tolerance: number): ProfilePath {
  const arch = archShape(span, rise);
  const half = span / 2;
  return withoutRepeats({
    start: [-half, 0],
    segments: [
      ...arcs(arch, 0, tolerance, -half, half),
      { kind: 'line', to: point(arch, half, thickness) },
      ...arcs(arch, thickness, tolerance, half, -half),
    ],
  });
}

interface Barrel {
  readonly arch: ArchShape;
  readonly half: number;
  height(distance: number, offset: number): number;
  distanceAt(z: number, offset: number): number | null;
}

function barrel(span: number, rise: number): Barrel {
  const arch = archShape(span, rise);
  const half = span / 2;
  const c = arch.left;
  return {
    arch,
    half,
    height: (distance, offset) => archHeightAt(arch, -Math.min(half, Math.abs(distance)), offset) ?? 0,
    distanceAt: (z, offset) => {
      const r = c.r + offset;
      const dz = z - c.cz;
      if (dz > r + ZERO) return null;
      return Math.min(half, Math.max(0, Math.sqrt(Math.max(0, r * r - dz * dz)) - c.cx));
    },
  };
}

interface GroinPoint {
  readonly dx: number;
  readonly dy: number;
  readonly z: number;
}

function groinPoints(a: Barrel, b: Barrel, offset: number, tolerance: number, thickness: number): GroinPoint[] {
  const found: GroinPoint[] = [];
  const wallA = a.height(a.half, offset), wallB = b.height(b.half, offset);
  for (const x of archSampleOffsets(a.arch, tolerance, thickness)) {
    const z = a.height(x, offset);
    const dy = z >= wallB ? b.distanceAt(z, offset) : null;
    if (x <= 0 && dy !== null) found.push({ dx: -x, dy, z });
  }
  for (const y of archSampleOffsets(b.arch, tolerance, thickness)) {
    const z = b.height(y, offset);
    const dx = z >= wallA ? a.distanceAt(z, offset) : null;
    if (y <= 0 && dx !== null) found.push({ dx, dy: -y, z });
  }
  if (wallA < wallB) {
    const dx = a.distanceAt(wallB, offset);
    if (dx !== null) found.push({ dx, dy: b.half, z: wallB });
  } else if (wallB < wallA) {
    const dy = b.distanceAt(wallA, offset);
    if (dy !== null) found.push({ dx: a.half, dy, z: wallA });
  }
  found.sort((p, q) => p.z - q.z || q.dx - p.dx);
  return found.filter((p, i) => i === 0 || Math.abs(p.dx - found[i - 1].dx) > ZERO || Math.abs(p.dy - found[i - 1].dy) > ZERO);
}

function stations(half: number, base: readonly number[], groins: readonly number[]): number[] {
  const distances = [0, ...base.map((x) => Math.abs(x)), ...groins].sort((p, q) => p - q)
    .filter((d, i, all) => i === 0 || d - all[i - 1] > ZERO);
  const out = distances.slice(1);
  return [...[...out].reverse().map((d) => half - d), half, ...out.map((d) => half + d)];
}

export function crossVaultGroins(width: number, depth: number, rise: number, tolerance: number): Vec3[][] {
  const a = barrel(width, rise), b = barrel(depth, rise);
  const points = groinPoints(a, b, 0, tolerance, 0);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => points.map((p): Vec3 => [width / 2 + sx * p.dx, depth / 2 + sy * p.dy, p.z]));
}

function newell(points: readonly Vec3[]): Vec3 {
  const n: Vec3 = [0, 0, 0];
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length];
    n[0] += (p[1] - q[1]) * (p[2] + q[2]);
    n[1] += (p[2] - q[2]) * (p[0] + q[0]);
    n[2] += (p[0] - q[0]) * (p[1] + q[1]);
  });
  return n;
}

class FaceBuilder {
  readonly coords: Vec3[] = [];
  readonly faces: number[][] = [];
  private readonly index = new Map<string, number>();

  vertex(key: string, p: Vec3): number {
    let id = this.index.get(key);
    if (id === undefined) {
      id = this.coords.push(p) - 1;
      this.index.set(key, id);
    }
    return id;
  }

  find(key: string): number | undefined {
    return this.index.get(key);
  }

  add(ids: number[], want: (normal: Vec3) => boolean): void {
    const unique = ids.filter((id, i) => id !== ids[(i + ids.length - 1) % ids.length]);
    if (new Set(unique).size < 3) return;
    this.faces.push(want(newell(unique.map((id) => this.coords[id]))) ? unique : [...unique].reverse());
  }
}

const edgeKey = (o: number, i0: number, j0: number, i1: number, j1: number) => `${o}|e|${Math.min(i0, i1)},${Math.min(j0, j1)},${Math.max(i0, i1)},${Math.max(j0, j1)}`;

export function crossVaultFaces(width: number, depth: number, rise: number, thickness: number, tolerance: number): FaceSet {
  const a = barrel(width, rise), b = barrel(depth, rise);
  const groins = [...groinPoints(a, b, 0, tolerance, thickness), ...groinPoints(a, b, thickness, tolerance, thickness)];
  const xs = stations(a.half, archSampleOffsets(a.arch, tolerance, thickness), groins.map((p) => p.dx));
  const ys = stations(b.half, archSampleOffsets(b.arch, tolerance, thickness), groins.map((p) => p.dy));
  const mesh = new FaceBuilder();
  const ha = (i: number, o: number) => a.height(xs[i] - a.half, o);
  const hb = (j: number, o: number) => b.height(ys[j] - b.half, o);
  const crossingOn = (ci: number, cj: number, ni: number, nj: number, o: number): Vec3 => {
    const side = (from: number, to: number, half: number) => Math.sign(from + to - 2 * half);
    if (ci === ni) {
      const z = ha(ci, o), d = b.distanceAt(z, o);
      if (d !== null) return [xs[ci], b.half + side(ys[cj], ys[nj], b.half) * d, z];
    } else {
      const z = hb(cj, o), d = a.distanceAt(z, o);
      if (d !== null) return [a.half + side(xs[ci], xs[ni], a.half) * d, ys[cj], z];
    }
    throw new Error('A cross vault groin left its grid edge');
  };
  const corner = (i: number, j: number, o: number) => mesh.vertex(`${o}|${i}|${j}`, [xs[i], ys[j], Math.max(ha(i, o), hb(j, o))]);
  for (const o of [0, thickness]) {
    for (let i = 0; i + 1 < xs.length; i++) for (let j = 0; j + 1 < ys.length; j++) {
      const ring: Array<[number, number]> = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
      const s = ring.map(([ci, cj]) => ha(ci, o) - hb(cj, o));
      const sideA: number[] = [], sideB: number[] = [];
      let crossed = false;
      ring.forEach(([ci, cj], k) => {
        const id = corner(ci, cj, o);
        if (s[k] >= -ZERO) sideA.push(id);
        if (s[k] <= ZERO) sideB.push(id);
        const [ni, nj] = ring[(k + 1) % 4], sn = s[(k + 1) % 4];
        if ((s[k] > ZERO && sn < -ZERO) || (s[k] < -ZERO && sn > ZERO)) {
          const cross = mesh.vertex(edgeKey(o, ci, cj, ni, nj), crossingOn(ci, cj, ni, nj, o));
          sideA.push(cross);
          sideB.push(cross);
          crossed = true;
        }
      });
      const up = (n: Vec3) => (n[2] > 0) === (o > 0);
      for (const side of [sideA, sideB]) {
        if (!crossed) mesh.add(side, up);
        else for (let f = 1; f + 1 < side.length; f++) mesh.add([side[0], side[f], side[f + 1]], up);
      }
    }
  }
  const walls: Array<{ along: number; at: (k: number) => [number, number]; outward: [number, number] }> = [
    { along: xs.length, at: (k) => [k, 0], outward: [0, -1] },
    { along: xs.length, at: (k) => [k, ys.length - 1], outward: [0, 1] },
    { along: ys.length, at: (k) => [0, k], outward: [-1, 0] },
    { along: ys.length, at: (k) => [xs.length - 1, k], outward: [1, 0] },
  ];
  for (const wall of walls) {
    for (let k = 0; k + 1 < wall.along; k++) {
      const [i0, j0] = wall.at(k), [i1, j1] = wall.at(k + 1);
      const crossing = (o: number) => {
        const id = mesh.find(edgeKey(o, i0, j0, i1, j1));
        return id === undefined ? [] : [id];
      };
      mesh.add([corner(i0, j0, 0), ...crossing(0), corner(i1, j1, 0), corner(i1, j1, thickness), ...crossing(thickness), corner(i0, j0, thickness)],
        (n) => n[0] * wall.outward[0] + n[1] * wall.outward[1] > 0);
    }
  }
  return { coords: mesh.coords, faces: mesh.faces };
}
