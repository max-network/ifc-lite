/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { buildCorridor, corridorProblems, crossFallRise, type CorridorDefinition } from './corridor.js';
import { horizontalAt } from './horizontal.js';
import { profileAt } from './profile.js';
import { CorridorRefusal } from './problems.js';

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

type Tri = readonly [number, number, number];

function edgeUse(triangles: readonly Tri[]): Map<string, number> {
  const uses = new Map<string, number>();
  for (const [a, b, c] of triangles) {
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const key = `${Math.min(p, q)},${Math.max(p, q)}`;
      uses.set(key, (uses.get(key) ?? 0) + 1);
    }
  }
  return uses;
}

describe('crossFallRise', () => {
  it('falls from the crown to both edges for a camber and to one side otherwise', () => {
    expect(crossFallRise(3, 0.025, 'camber')).toBeCloseTo(-0.075, 15);
    expect(crossFallRise(-3, 0.025, 'camber')).toBeCloseTo(-0.075, 15);
    expect(crossFallRise(3, 0.025, 'left')).toBeCloseTo(-0.075, 15);
    expect(crossFallRise(-3, 0.025, 'left')).toBeCloseTo(0.075, 15);
    expect(crossFallRise(3, 0.025, 'right')).toBeCloseTo(0.075, 15);
  });
});

describe('buildCorridor', () => {
  const corridor = buildCorridor(STREET);
  const columns = corridor.columns.length;

  it('places every vertex on the profile and cross-fall formulas', () => {
    let worst = 0;
    corridor.stations.forEach((s, i) => {
      const frame = horizontalAt(corridor.horizontal, s);
      const z = profileAt(corridor.vertical, s).height;
      corridor.columns.forEach((column, c) => {
        const [x, y, h] = corridor.mesh.positions[i * columns + c];
        const ex = frame.x - Math.sin(frame.direction) * column.offset;
        const ey = frame.y + Math.cos(frame.direction) * column.offset;
        const eh = z + crossFallRise(Math.sign(column.offset) * Math.min(Math.abs(column.offset), STREET.Width / 2), STREET.CrossFall, 'camber') + column.raise;
        worst = Math.max(worst, Math.hypot(x - ex, y - ey), Math.abs(h - eh));
      });
    });
    expect(worst).toBeLessThan(1e-9);
  });

  it('raises the kerb top by the kerb height above the carriageway edge', () => {
    expect(corridor.columns.map((c) => [c.offset, c.raise])).toEqual([
      [3.3, 0.12], [3, 0.12], [3, 0], [0, 0], [-3, 0], [-3, 0.12], [-3.3, 0.12],
    ]);
  });

  it('shares vertices between adjacent strips so the surface has no cracks', () => {
    const all = [...corridor.mesh.pavement, ...corridor.mesh.kerbLeft, ...corridor.mesh.kerbRight];
    const uses = edgeUse(all);
    expect([...uses.values()].every((n) => n <= 2)).toBe(true);
    const n = corridor.stations.length;
    const boundary = [...uses.values()].filter((count) => count === 1).length;
    expect(boundary).toBe(2 * (n - 1) + 2 * (columns - 1));
  });

  it('bounds the triangle count by the stations and columns', () => {
    const n = corridor.stations.length;
    const total = corridor.mesh.pavement.length + corridor.mesh.kerbLeft.length + corridor.mesh.kerbRight.length;
    expect(total).toBe(2 * (n - 1) * (columns - 1));
  });

  it('turns the driving surface and kerb tops up', () => {
    for (const [a, b, c] of [...corridor.mesh.pavement, ...corridor.mesh.kerbLeft]) {
      const [p, q, r] = [a, b, c].map((i) => corridor.mesh.positions[i]);
      const nz = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
      expect(nz).toBeGreaterThanOrEqual(-1e-12);
    }
  });

  it('outlines the outer kerb edges as one closed loop around the street', () => {
    const n = corridor.stations.length;
    expect(corridor.outline.length).toBe(2 * n + 2 * 3);
    expect(corridor.outline[0]).toEqual(corridor.mesh.positions[0]);
  });

  it('reports the grades and vertical curves it built', () => {
    expect(corridor.grades.map((g) => g.grade)).toEqual([expect.closeTo(0.04, 12), expect.closeTo(0.08, 12)]);
    expect(corridor.curves[0].length).toBeCloseTo(16, 12);
  });
});

describe('corridor refusals', () => {
  it('refuses a width of zero or less', () => {
    expect(corridorProblems({ ...STREET, Width: 0 }).map((p) => p.code)).toContain('width');
  });

  it('refuses a self-intersecting centreline', () => {
    const problems = corridorProblems({ ...STREET, Centreline: [[0, 0], [40, 0], [40, 40], [20, -20]], Radii: [5, 5], Profile: [{ Station: 0, Height: 0 }] });
    expect(problems.map((p) => p.code)).toContain('self_intersecting');
  });

  it('refuses edges that overlap where the centreline doubles back closer than the width', () => {
    const problems = corridorProblems({ ...STREET, Centreline: [[0, 0], [40, 0], [40, 20], [5, 20], [5, 4], [30, 4]], Radii: [5, 5, 5, 5], Profile: [{ Station: 0, Height: 0 }] });
    expect(problems.map((p) => p.code)).toContain('self_intersecting');
  });

  it('throws every problem at once', () => {
    expect(() => buildCorridor({ ...STREET, Width: -1, MaxGrade: 0.01 })).toThrow(CorridorRefusal);
  });
});
