/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { buildCorridor, type CorridorDefinition } from './corridor.js';
import { fitTinToOutlines, type Tin, type TinPoint } from './tin-fit.js';

const STREET: CorridorDefinition = {
  Centreline: [[0, 0], [30, 0], [55, 25]],
  Radii: [15],
  Width: 6,
  CrossFall: 0.025,
  CrossFallSide: 'camber',
  Profile: [{ Station: 0, Height: 100 }, { Station: 40, Grade: 0.04 }, { Station: 60, Grade: 0.08 }],
  MaxGrade: 0.12,
  MinK: 4,
  Kerb: { Height: 0.12, Width: 0.3 },
};

function terrain(): Tin {
  const xs = Array.from({ length: 17 }, (_, i) => -10 + i * 5);
  const ys = Array.from({ length: 17 }, (_, i) => -30 + i * 5);
  const points: TinPoint[] = ys.flatMap((y) => xs.map((x): TinPoint => [x, y, 99 + 0.06 * x - 0.02 * y]));
  const triangles: [number, number, number][] = [];
  for (let j = 0; j + 1 < ys.length; j++) {
    for (let i = 0; i + 1 < xs.length; i++) {
      const [a, b, c, d] = [j * xs.length + i, j * xs.length + i + 1, (j + 1) * xs.length + i + 1, (j + 1) * xs.length + i];
      triangles.push([a, b, c], [a, c, d]);
    }
  }
  return { points, triangles };
}

type Segment = [[number, number], [number, number]];

function cutAtX(points: readonly TinPoint[], triangles: readonly (readonly [number, number, number])[], x: number): Segment[] {
  const segments: Segment[] = [];
  for (const tri of triangles) {
    const crossings: [number, number][] = [];
    for (let k = 0; k < 3; k++) {
      const p = points[tri[k]];
      const q = points[tri[(k + 1) % 3]];
      if ((p[0] - x) * (q[0] - x) > 0 || p[0] === q[0]) continue;
      const t = (x - p[0]) / (q[0] - p[0]);
      crossings.push([p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]);
    }
    const unique = crossings.filter((c, i) => crossings.findIndex((d) => Math.hypot(d[0] - c[0], d[1] - c[1]) < 1e-12) === i);
    if (unique.length === 2) segments.push([unique[0], unique[1]]);
  }
  return segments;
}

function heightOnMesh(points: readonly TinPoint[], triangles: readonly (readonly [number, number, number])[], x: number, y: number): number | null {
  for (const [a, b, c] of triangles) {
    const [p, q, r] = [points[a], points[b], points[c]];
    const d = (q[1] - r[1]) * (p[0] - r[0]) + (r[0] - q[0]) * (p[1] - r[1]);
    if (Math.abs(d) < 1e-14) continue;
    const u = ((q[1] - r[1]) * (x - r[0]) + (r[0] - q[0]) * (y - r[1])) / d;
    const v = ((r[1] - p[1]) * (x - r[0]) + (p[0] - r[0]) * (y - r[1])) / d;
    const w = 1 - u - v;
    if (u >= -1e-9 && v >= -1e-9 && w >= -1e-9) return u * p[2] + v * q[2] + w * r[2];
  }
  return null;
}

describe('a street set into the terrain', () => {
  const corridor = buildCorridor(STREET);
  const street = corridor.mesh;
  const streetTriangles = [...street.pavement, ...street.kerbLeft, ...street.kerbRight];
  const fitted = fitTinToOutlines(terrain(), [corridor.outline]);

  it('lets the terrain meet the street edge with no gap and no step', () => {
    const tops = [...street.kerbLeft, ...street.kerbRight].filter(([a, b, c]) => {
      const [p, q, r] = [a, b, c].map((i) => street.positions[i]);
      return Math.abs((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])) > 1e-9;
    });
    const boundary = new Map<string, number>();
    for (const [a, b, c] of fitted.triangles) {
      for (const [p, q] of [[a, b], [b, c], [c, a]]) {
        const key = `${Math.min(p, q)},${Math.max(p, q)}`;
        boundary.set(key, (boundary.get(key) ?? 0) + 1);
      }
    }
    const columns = corridor.columns.length;
    const last = (corridor.stations.length - 1) * columns;
    const caps = [[0, columns - 1], [last, last + columns - 1]].map(([a, b]) => [street.positions[a], street.positions[b]] as const);
    const onCap = (x: number, y: number) => caps.some(([a, b]) => {
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      return Math.abs(dx * (y - a[1]) - dy * (x - a[0])) / Math.hypot(dx, dy) < 1e-7;
    });
    let sides = 0;
    let ends = 0;
    for (const [key, uses] of boundary) {
      if (uses !== 1) continue;
      for (const v of key.split(',').map(Number)) {
        const [x, y, z] = fitted.points[v];
        if (Math.abs(x - 70) < 1e-9 || Math.abs(x + 10) < 1e-9 || Math.abs(y + 30) < 1e-9 || Math.abs(y - 50) < 1e-9) continue;
        const pavement = heightOnMesh(street.positions, street.pavement, x, y);
        if (pavement !== null) {
          expect(Math.abs(z - pavement)).toBeLessThan(1e-6);
          ends++;
          continue;
        }
        if (onCap(x, y)) continue;
        const kerbTop = heightOnMesh(street.positions, tops, x, y);
        expect(kerbTop).not.toBeNull();
        expect(Math.abs(z - (kerbTop ?? Infinity))).toBeLessThan(1e-6);
        sides++;
      }
    }
    expect(sides).toBeGreaterThan(corridor.stations.length);
    expect(ends).toBeGreaterThan(4);
  });

  it('draws one continuous line where a section cuts across terrain and street', () => {
    const segments = [...cutAtX(fitted.points, fitted.triangles, 10.123), ...cutAtX(street.positions, streetTriangles, 10.123)];
    const ends = segments.flat();
    const count = (p: [number, number]) => ends.filter((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-7).length;
    const loose = ends.filter((p) => count(p) === 1);
    expect(loose).toHaveLength(2);
    expect(loose.map((p) => p[0]).sort((a, b) => a - b)).toEqual([expect.closeTo(-30, 9), expect.closeTo(50, 9)]);
  });
});
