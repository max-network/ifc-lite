/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { archCircleAt, archHeightAt, archSampleOffsets, archShape, archArcs, chordSegments } from './arch-shape.js';

describe('archShape', () => {
  it('is round when the rise is half the span, with its centre on the springing line', () => {
    const arch = archShape(4, 2);
    expect(arch.kind).toBe('round');
    expect(archHeightAt(arch, 0)).toBeCloseTo(2, 9);
    expect(archHeightAt(arch, 2)).toBeCloseTo(0, 9);
    expect(archHeightAt(arch, -2)).toBeCloseTo(0, 9);
    expect(archHeightAt(arch, 1)).toBeCloseTo(Math.sqrt(3), 9);
  });

  it('is segmental below half the span: springs at both ends and peaks at the crown', () => {
    const arch = archShape(6, 0.8);
    expect(arch.kind).toBe('segmental');
    expect(archHeightAt(arch, 0)).toBeCloseTo(0.8, 9);
    expect(archHeightAt(arch, 3)).toBeCloseTo(0, 9);
    expect(archHeightAt(arch, -3)).toBeCloseTo(0, 9);
  });

  it('is pointed above half the span: two arcs meeting at the crown', () => {
    const arch = archShape(4, 3);
    expect(arch.kind).toBe('pointed');
    expect(archHeightAt(arch, 0)).toBeCloseTo(3, 9);
    expect(archHeightAt(arch, -2)).toBeCloseTo(0, 9);
    expect(archHeightAt(arch, 2)).toBeCloseTo(0, 9);
    expect(archHeightAt(arch, -0.01)).toBeLessThan(3);
    expect(archHeightAt(arch, 0.01)).toBeLessThan(3);
  });

  it('offsets concentrically: the extrados crown is the rise plus the thickness on a round arch', () => {
    const arch = archShape(4, 2);
    expect(archHeightAt(arch, 0, 0.3)).toBeCloseTo(2.3, 9);
    expect(archHeightAt(arch, 2, 0.3)).toBeCloseTo(Math.sqrt(2.3 ** 2 - 4), 9);
  });

  it('refuses a span or rise that is not positive and finite', () => {
    expect(() => archShape(0, 1)).toThrow(/span/);
    expect(() => archShape(4, 0)).toThrow(/rise/);
    expect(() => archShape(4, Number.NaN)).toThrow(/rise/);
  });

  it('samples symmetric offsets from one springing to the other, through the crown', () => {
    for (const arch of [archShape(4, 2), archShape(6, 0.8), archShape(4, 3)]) {
      const xs = archSampleOffsets(arch, 0.05);
      expect(xs[0]).toBeCloseTo(-arch.span / 2, 12);
      expect(xs[xs.length - 1]).toBeCloseTo(arch.span / 2, 12);
      expect(xs).toContain(0);
      expect(xs.every((x, i) => i === 0 || x > xs[i - 1])).toBe(true);
      xs.forEach((x, i) => expect(x).toBeCloseTo(-xs[xs.length - 1 - i], 12));
    }
  });
});

describe('arch formulas', () => {
  const onCircle = (x: number, z: number, c: { cx: number; cz: number; r: number }) => Math.hypot(x - c.cx, z - c.cz) - c.r;

  it('derives a segmental arch: r = (s²/4 + f²) / 2f, centre f - r above the springing on the midline', () => {
    const s = 5.2, f = 1.1;
    const arch = archShape(s, f);
    const r = (s * s / 4 + f * f) / (2 * f);
    expect(arch.left).toEqual({ cx: 0, cz: f - r, r });
    expect(arch.right).toEqual(arch.left);
  });

  it('derives a pointed arch from two equal circles through both springings and the crown', () => {
    const s = 4, f = 3.2;
    const arch = archShape(s, f);
    expect(arch.left.r).toBeCloseTo(arch.right.r, 12);
    expect(arch.left.cz).toBe(0);
    for (const c of [arch.left, arch.right]) expect(onCircle(0, f, c)).toBeCloseTo(0, 12);
    expect(onCircle(-s / 2, 0, arch.left)).toBeCloseTo(0, 12);
    expect(onCircle(s / 2, 0, arch.right)).toBeCloseTo(0, 12);
  });

  it('picks the fewest chords whose sagitta r(1 - cos(θ/2n)) stays under the tolerance', () => {
    for (const [r, angle, tolerance] of [[3, Math.PI / 2, 0.005], [40, 1.2, 0.005], [0.6, Math.PI, 0.001], [12, 0.01, 0.005]]) {
      const n = chordSegments(r, angle, tolerance);
      expect(r * (1 - Math.cos(angle / (2 * n)))).toBeLessThanOrEqual(tolerance);
      if (n > 1) expect(r * (1 - Math.cos(angle / (2 * (n - 1))))).toBeGreaterThan(tolerance);
    }
  });

  it('samples an arch on its circle with every chord within the sagitta bound', () => {
    for (const arch of [archShape(4, 2), archShape(9, 1.4), archShape(4, 3.2), archShape(30, 15)]) {
      const xs = archSampleOffsets(arch, 0.005);
      const points = xs.map((x) => [x, archHeightAt(arch, x) ?? Number.NaN]);
      points.forEach(([x, z]) => expect(Math.abs(onCircle(x, z, archCircleAt(arch, x)))).toBeLessThan(1e-9));
      for (let i = 1; i < points.length; i++) {
        const circle = archCircleAt(arch, (points[i - 1][0] + points[i][0]) / 2);
        const chord = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
        expect(circle.r - Math.sqrt(circle.r ** 2 - chord ** 2 / 4)).toBeLessThanOrEqual(0.005 + 1e-12);
      }
      expect(points[0][1]).toBeCloseTo(0, 9);
      expect(Math.max(...points.map((p) => p[1]))).toBeCloseTo(arch.rise, 9);
    }
  });

  it('splits an arch into sub-arcs a kernel drawing at least four chords each keeps within the bound', () => {
    for (const arch of [archShape(12, 6), archShape(9, 1.4), archShape(4, 3.2)]) {
      const pieces = archArcs(arch, 0.3, -arch.span / 2, arch.span / 2, 0.005, 4);
      let from: [number, number] = [-arch.span / 2, archHeightAt(arch, -arch.span / 2, 0.3) ?? 0];
      for (const { via, to } of pieces) {
        const c = archCircleAt(arch, (from[0] + to[0]) / 2);
        for (const p of [via, to]) expect(Math.abs(onCircle(p[0], p[1], { ...c, r: c.r + 0.3 }))).toBeLessThan(1e-9);
        const angle = (p: [number, number]) => Math.atan2(p[1] - c.cz, p[0] - c.cx);
        expect((c.r + 0.3) * (1 - Math.cos(Math.abs(angle(to) - angle(from)) / 8))).toBeLessThanOrEqual(0.005 + 1e-12);
        from = to;
      }
      expect(from[0]).toBeCloseTo(arch.span / 2, 12);
      expect(pieces.some((p) => p.to[0] === 0)).toBe(true);
    }
  });
});
