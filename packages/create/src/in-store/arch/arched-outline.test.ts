/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { archedFramePath, archedOpeningPath, archedRingPaths, rectUnderArch } from './arched-outline.js';
import { pathPoints, type Pt2 } from './profile-path.js';

const area = (points: readonly Pt2[]) => points.reduce((sum, p, i) => {
  const q = points[(i + 1) % points.length];
  return sum + p[0] * q[1] - q[0] * p[1];
}, 0) / 2;
const near = (actual: Record<string, number>, expected: Record<string, number>) => {
  for (const [key, value] of Object.entries(expected)) expect(actual[key]).toBeCloseTo(value, 9);
};
const bounds = (points: readonly Pt2[]) => ({
  minX: Math.min(...points.map((p) => p[0])), maxX: Math.max(...points.map((p) => p[0])),
  minZ: Math.min(...points.map((p) => p[1])), maxZ: Math.max(...points.map((p) => p[1])),
});

describe('arched outlines', () => {
  const round = { width: 1.2, height: 2, rise: 0.6 };
  const segmental = { width: 1.2, height: 2, rise: 0.25 };

  it('cuts a round-headed opening as wide as asked and as high as its crown, anticlockwise', () => {
    const points = pathPoints(archedOpeningPath(round), 64);
    near(bounds(points), { minX: -0.6, maxX: 0.6, minZ: 0 });
    expect(bounds(points).maxZ).toBeCloseTo(2, 9);
    expect(area(points)).toBeCloseTo(1.2 * 1.4 + Math.PI * 0.36 / 2, 3);
  });

  it('keeps a segmental head between the springing and the crown', () => {
    const path = archedOpeningPath(segmental);
    const arcs = path.segments.filter((s) => s.kind === 'arc');
    expect(arcs).toHaveLength(2);
    expect(arcs[0].to).toEqual([0, 2]);
    expect(arcs[1].to[0]).toBeCloseTo(-0.6, 12);
    expect(arcs[1].to[1]).toBeCloseTo(1.75, 12);
    const points = pathPoints(path, 64);
    for (const [x, z] of points) if (z > 1.75 + 1e-9) expect(Math.abs(x)).toBeLessThan(0.6);
    expect(bounds(points).maxZ).toBeCloseTo(2, 9);
  });

  it('rings a lining inside the opening with a concentric inner arch', () => {
    const { outer, inner } = archedRingPaths(round, 0.05);
    const out = pathPoints(outer, 64), inn = pathPoints(inner, 64);
    near(bounds(inn), { minX: -0.55, maxX: 0.55, minZ: 0.05 });
    expect(bounds(inn).maxZ).toBeCloseTo(1.95, 9);
    expect(area(out) - area(inn)).toBeGreaterThan(0);
  });

  it('frames a door with jambs and an arched head, open at the floor', () => {
    const frame = pathPoints(archedFramePath(round, 0.05), 64);
    const opening = pathPoints(archedOpeningPath(round), 64);
    const clear = pathPoints(archedRingPaths({ ...round }, 0.05).inner, 64);
    expect(area(frame)).toBeGreaterThan(0);
    expect(area(frame)).toBeLessThan(area(opening) - area(clear) + 0.05 * 1.1 + 1e-3);
    expect(bounds(frame).maxZ).toBeCloseTo(2, 9);
  });

  it('leaves a pane below the springing rectangular and clips one reaching into the head to the arch', () => {
    const low = rectUnderArch({ x0: -0.55, z0: 0.05, x1: 0.55, z1: 1.3 }, round, 0.05);
    expect(low?.segments.every((s) => s.kind === 'line')).toBe(true);
    const high = rectUnderArch({ x0: -0.55, z0: 0.05, x1: 0.55, z1: 1.95 }, round, 0.05);
    const points = pathPoints(high!, 64);
    expect(bounds(points).maxZ).toBeCloseTo(1.95, 9);
    for (const [x, z] of points) {
      const archTop = 1.4 + Math.sqrt(Math.max(0, 0.55 ** 2 - x * x));
      expect(z).toBeLessThanOrEqual(Math.max(archTop, 0.05) + 1e-9);
    }
  });

  it('narrows a pane whose bottom lies in the head to where the arch still clears it', () => {
    const top = rectUnderArch({ x0: -0.55, z0: 1.7, x1: 0.55, z1: 1.95 }, round, 0.05);
    const points = pathPoints(top!, 64);
    const halfWidth = Math.sqrt(0.55 ** 2 - 0.3 ** 2);
    expect(bounds(points).minX).toBeCloseTo(-halfWidth, 9);
    expect(bounds(points).maxX).toBeCloseTo(halfWidth, 9);
    expect(rectUnderArch({ x0: -0.55, z0: 1.96, x1: 0.55, z1: 1.99 }, round, 0.05)).toBeNull();
  });
});

describe('arched heads from the arch formula', () => {
  const gate = { width: 4, height: 3.2, rise: 2 };

  it('puts every head arc point on the circle through both springings and the crown', () => {
    const r = (4 ** 2 / 4 + 2 ** 2) / (2 * 2), cz = 3.2 - 2 + 2 - r;
    for (const segment of archedOpeningPath(gate).segments) {
      if (segment.kind !== 'arc') continue;
      for (const [x, z] of [segment.via, segment.to]) expect(Math.hypot(x, z - cz)).toBeCloseTo(r, 9);
    }
  });

  it('splits a wide head into arcs a four-chord kernel keeps within 5 mm', () => {
    for (const path of [archedOpeningPath(gate), archedRingPaths(gate, 0.06).inner, archedFramePath(gate, 0.06)]) {
      let from = path.start;
      for (const segment of path.segments) {
        if (segment.kind === 'arc') {
          const cz = 1.2;
          const r = Math.hypot(segment.to[0], segment.to[1] - cz);
          const angle = (p: readonly [number, number]) => Math.atan2(p[1] - cz, p[0]);
          expect(r * (1 - Math.cos(Math.abs(angle(segment.to) - angle(from)) / 8))).toBeLessThanOrEqual(0.005 + 1e-12);
        }
        from = segment.to;
      }
    }
  });
});
