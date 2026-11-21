/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { fitTinToOutlines, type Tin, type TinPoint } from './tin-fit.js';

type Tri = readonly [number, number, number];

function gridTin(xs: readonly number[], ys: readonly number[], z: (x: number, y: number) => number, skip?: (x: number, y: number) => boolean): Tin {
  const points: TinPoint[] = ys.flatMap((y) => xs.map((x): TinPoint => [x, y, z(x, y)]));
  const triangles: Tri[] = [];
  const n = xs.length;
  for (let j = 0; j + 1 < ys.length; j++) {
    for (let i = 0; i + 1 < n; i++) {
      if (skip?.((xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2)) continue;
      const [a, b, c, d] = [j * n + i, j * n + i + 1, (j + 1) * n + i + 1, (j + 1) * n + i];
      triangles.push([a, b, c], [a, c, d]);
    }
  }
  return { points, triangles };
}

const area = (tin: Tin, [a, b, c]: Tri): number => {
  const [p, q, r] = [tin.points[a], tin.points[b], tin.points[c]];
  return ((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])) / 2;
};

function inside(loop: readonly TinPoint[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const [xi, yi] = loop[i];
    const [xj, yj] = loop[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function onSegment(p: TinPoint, a: TinPoint, b: TinPoint): number | null {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length2 = dx * dx + dy * dy;
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length2;
  if (t < -1e-9 || t > 1 + 1e-9) return null;
  const distance = Math.abs(dx * (p[1] - a[1]) - dy * (p[0] - a[0])) / Math.sqrt(length2);
  return distance < 1e-7 ? t : null;
}

function conforming(tin: Tin): void {
  const uses = new Map<string, number>();
  for (const [a, b, c] of tin.triangles) {
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const key = `${Math.min(p, q)},${Math.max(p, q)}`;
      uses.set(key, (uses.get(key) ?? 0) + 1);
    }
  }
  expect([...uses.values()].every((count) => count <= 2)).toBe(true);
  const used = new Set(tin.triangles.flat());
  for (const key of uses.keys()) {
    const [p, q] = key.split(',').map(Number);
    for (const v of used) {
      if (v === p || v === q) continue;
      const t = onSegment(tin.points[v], tin.points[p], tin.points[q]);
      expect(t === null || t <= 1e-6 || t >= 1 - 1e-6).toBe(true);
    }
  }
  for (const tri of tin.triangles) expect(area(tin, tri)).toBeGreaterThan(0);
}

const XS = [0, 5, 10, 15, 20];
const slope = (x: number, y: number) => 0.1 * x + 0.05 * y;
const STRIP: TinPoint[] = [[-5, 8, 3], [25, 8, 3.5], [25, 12, 3.5], [-5, 12, 3]];

describe('fitTinToOutlines', () => {
  const source = gridTin(XS, XS, slope);
  const fitted = fitTinToOutlines(source, [STRIP]);

  it('keeps the source points untouched as a prefix', () => {
    expect(fitted.points.slice(0, source.points.length)).toEqual(source.points);
  });

  it('removes the terrain under the outline and keeps all of it outside', () => {
    for (const [a, b, c] of fitted.triangles) {
      const x = (fitted.points[a][0] + fitted.points[b][0] + fitted.points[c][0]) / 3;
      const y = (fitted.points[a][1] + fitted.points[b][1] + fitted.points[c][1]) / 3;
      expect(inside(STRIP, x, y)).toBe(false);
    }
    const total = fitted.triangles.reduce((sum, tri) => sum + area(fitted, tri), 0);
    expect(total).toBeCloseTo(400 - 20 * 4, 9);
  });

  it('stays one conforming surface: no T-junctions, no overlaps, no folded triangles', () => {
    conforming(fitted);
  });

  it('meets the outline at the outline heights, with no gap and no step', () => {
    let onOutline = 0;
    for (const v of new Set(fitted.triangles.flat())) {
      const p = fitted.points[v];
      for (let k = 0; k < STRIP.length; k++) {
        const a = STRIP[k];
        const b = STRIP[(k + 1) % STRIP.length];
        const t = onSegment(p, a, b);
        if (t === null) continue;
        onOutline++;
        expect(Math.abs(p[2] - (a[2] + (b[2] - a[2]) * t))).toBeLessThan(1e-9);
      }
    }
    expect(onOutline).toBeGreaterThanOrEqual(4);
  });

  it('leaves the terrain away from the outline exactly as it was', () => {
    const key = (tri: Tri) => [...tri].sort((p, q) => p - q).join(',');
    const kept = new Set(fitted.triangles.map(key));
    for (const tri of source.triangles.slice(0, 8)) expect(kept.has(key(tri))).toBe(true);
  });

  it('takes the outline height at a source vertex that lies exactly on the outline', () => {
    const onGrid: TinPoint[] = [[-5, 10, 4], [25, 10, 4], [25, 14, 4], [-5, 14, 4]];
    const result = fitTinToOutlines(source, [onGrid]);
    conforming(result);
    const at = [...new Set(result.triangles.flat())].filter((v) => Math.abs(result.points[v][1] - 10) < 1e-12);
    expect(at.length).toBeGreaterThan(0);
    for (const v of at) expect(result.points[v][2]).toBeCloseTo(4, 12);
    expect(result.points.slice(0, source.points.length)).toEqual(source.points);
  });

  it('cuts a hole for an outline wholly inside one triangle', () => {
    const small: TinPoint[] = [[1, 0.4, 1], [2, 0.4, 1], [2, 0.8, 1], [1, 0.8, 1]];
    const result = fitTinToOutlines(source, [small]);
    conforming(result);
    expect(result.triangles.reduce((sum, tri) => sum + area(result, tri), 0)).toBeCloseTo(400 - 0.4, 9);
  });

  it('respects a hole the source already has', () => {
    const holed = gridTin(XS, XS, slope, (x, y) => x > 10 && x < 15 && y > 5 && y < 15);
    const result = fitTinToOutlines(holed, [STRIP]);
    conforming(result);
    expect(result.triangles.reduce((sum, tri) => sum + area(result, tri), 0)).toBeCloseTo(400 - 50 - 20 * 4 + 5 * 4, 9);
  });
});
