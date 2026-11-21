/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { centrelineLength, centrelineSegments, horizontalAt, polylineSelfIntersects } from './horizontal.js';

const JOIN = 1e-9;

function joinsAreTangent(points: readonly (readonly [number, number])[], radii: readonly (number | null)[] = []) {
  const { segments, problems } = centrelineSegments(points, radii, 1);
  expect(problems).toEqual([]);
  segments.slice(1).forEach((next, i) => {
    const previous = segments[i];
    expect(Math.hypot(previous.end[0] - next.start[0], previous.end[1] - next.start[1])).toBeLessThan(JOIN);
    expect(Math.abs(Math.sin(previous.endDirection - next.direction))).toBeLessThan(JOIN);
  });
  return segments;
}

describe('centrelineSegments', () => {
  it('turns two points into one line stationed by its length', () => {
    const segments = joinsAreTangent([[0, 0], [30, 40]]);
    expect(segments).toHaveLength(1);
    expect(segments[0].type).toBe('LINE');
    expect(centrelineLength(segments)).toBeCloseTo(50, 12);
    const mid = horizontalAt(segments, 25);
    expect(mid.x).toBeCloseTo(15, 12);
    expect(mid.y).toBeCloseTo(20, 12);
  });

  it('rounds a corner with a tangent arc of the given radius, stationed by arc length', () => {
    const segments = joinsAreTangent([[0, 0], [40, 0], [40, 40]], [10]);
    expect(segments.map((s) => s.type)).toEqual(['LINE', 'CIRCULARARC', 'LINE']);
    const arc = segments[1];
    expect(arc.startRadius).toBeCloseTo(10, 12);
    expect(arc.length).toBeCloseTo((10 * Math.PI) / 2, 12);
    expect(centrelineLength(segments)).toBeCloseTo(30 + (10 * Math.PI) / 2 + 30, 9);
    for (let s = 30; s <= 30 + arc.length; s += 0.5) {
      const p = horizontalAt(segments, s);
      expect(Math.hypot(p.x - 30, p.y - 10)).toBeCloseTo(10, 9);
    }
  });

  it('turns clockwise with a negative signed radius', () => {
    const segments = joinsAreTangent([[0, 0], [40, 0], [40, -40]], [10]);
    expect(segments[1].startRadius).toBeCloseTo(-10, 12);
    expect(horizontalAt(segments, centrelineLength(segments)).y).toBeCloseTo(-40, 9);
  });

  it('fits the largest smooth arc where no radius is given', () => {
    const segments = joinsAreTangent([[0, 0], [20, 0], [20, 10], [40, 10]]);
    expect(segments.filter((s) => s.type === 'CIRCULARARC')).toHaveLength(2);
  });

  it('refuses a radius whose tangents do not fit on the legs', () => {
    const { problems } = centrelineSegments([[0, 0], [10, 0], [10, 10]], [50], 1);
    expect(problems.map((p) => p.code)).toContain('radius_too_large');
    expect(problems[0].vertex).toBe(1);
  });

  it('refuses a radius tighter than half the width, where the inner edge would fold', () => {
    const { problems } = centrelineSegments([[0, 0], [40, 0], [40, 40]], [2], 3);
    expect(problems.map((p) => p.code)).toEqual(['radius_below_half_width']);
  });

  it('refuses repeated points', () => {
    const { problems } = centrelineSegments([[0, 0], [0, 0], [10, 0]], [], 1);
    expect(problems.map((p) => p.code)).toEqual(['centreline']);
  });
});

describe('polylineSelfIntersects', () => {
  it('finds a crossing between legs that do not touch', () => {
    expect(polylineSelfIntersects([[0, 0], [10, 0], [10, 10], [5, -5]], false)).toBe(true);
  });

  it('accepts a polyline whose legs only meet at shared vertices', () => {
    expect(polylineSelfIntersects([[0, 0], [10, 0], [10, 10], [0, 10]], false)).toBe(false);
    expect(polylineSelfIntersects([[0, 0], [10, 0], [10, 10], [0, 10]], true)).toBe(false);
  });
});
