/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { buildCorridor, corridorProblems, type CorridorDefinition } from './corridor.js';
import { centrelineLength, centrelineSegments, horizontalAt, offsetFrom, type PlanXY } from './horizontal.js';
import { profileAt } from './profile.js';

const RADIUS = 12;
const TRANSITION = 15;
const HALF_WIDTH = 3;
const BEND: PlanXY[] = [[0, 0], [60, 0], [60, 60]];
const STEP = 0.01;
const CURVATURE_TOLERANCE = 1e-4;
const EDGE_TOLERANCE = 0.005;

function bend() {
  const result = centrelineSegments(BEND, [RADIUS], HALF_WIDTH, [TRANSITION]);
  expect(result.problems).toEqual([]);
  return result.segments;
}

function nearest(points: readonly PlanXY[], p: PlanXY): number {
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    const [ux, uy] = [b[0] - a[0], b[1] - a[1]];
    const length2 = ux * ux + uy * uy;
    const t = length2 === 0 ? 0 : Math.min(Math.max(((p[0] - a[0]) * ux + (p[1] - a[1]) * uy) / length2, 0), 1);
    best = Math.min(best, Math.hypot(p[0] - a[0] - ux * t, p[1] - a[1] - uy * t));
  }
  return best;
}

describe('transition curves between straight and arc', () => {
  it('puts a clothoid, an arc and a clothoid into a 90° bend, joined in position, direction and curvature', () => {
    const segments = bend();
    expect(segments.map((s) => s.type)).toEqual(['LINE', 'CLOTHOID', 'CIRCULARARC', 'CLOTHOID', 'LINE']);
    segments.slice(1).forEach((next, i) => {
      const previous = segments[i];
      expect(Math.hypot(previous.end[0] - next.start[0], previous.end[1] - next.start[1])).toBeLessThan(1e-9);
      expect(Math.abs(Math.sin(previous.endDirection - next.direction))).toBeLessThan(1e-9);
      expect(previous.endCurvature).toBeCloseTo(next.startCurvature, 12);
    });
    const [, entry, arc, exit, last] = segments;
    expect(entry.length).toBeCloseTo(TRANSITION, 12);
    expect(exit.length).toBeCloseTo(TRANSITION, 12);
    expect(arc.length).toBeCloseTo(RADIUS * (Math.PI / 2 - TRANSITION / RADIUS), 9);
    expect(last.end[0]).toBeCloseTo(60, 9);
    expect(last.end[1]).toBeCloseTo(60, 9);
  });

  it('has curvature 0 at the tangent points, rising linearly to 1/R as κ = s / (R·L)', () => {
    const segments = bend();
    const ts = segments[0].length;
    const sc = ts + TRANSITION;
    const cs = sc + segments[2].length;
    const st = cs + TRANSITION;
    const expected = (s: number) => {
      if (s <= ts || s >= st) return 0;
      if (s < sc) return (s - ts) / (RADIUS * TRANSITION);
      if (s <= cs) return 1 / RADIUS;
      return (st - s) / (RADIUS * TRANSITION);
    };
    for (let s = STEP; s < centrelineLength(segments) - STEP; s += 0.25) {
      const before = horizontalAt(segments, s - STEP).direction;
      const after = horizontalAt(segments, s + STEP).direction;
      const curvature = Math.atan2(Math.sin(after - before), Math.cos(after - before)) / (2 * STEP);
      expect(Math.abs(curvature - expected(s)), `station ${s}`).toBeLessThan(CURVATURE_TOLERANCE);
    }
    expect(Math.abs(expected(ts))).toBe(0);
    expect(Math.abs(expected(st))).toBe(0);
  });

  it('keeps both edges parallel to the centreline', () => {
    const segments = bend();
    const length = centrelineLength(segments);
    const centre: PlanXY[] = [];
    for (let s = 0; s <= length; s += 0.02) {
      const frame = horizontalAt(segments, s);
      centre.push([frame.x, frame.y]);
    }
    for (let s = 0; s <= length; s += 0.5) {
      const frame = horizontalAt(segments, s);
      for (const offset of [HALF_WIDTH, -HALF_WIDTH]) expect(Math.abs(nearest(centre, offsetFrom(frame, offset)) - HALF_WIDTH)).toBeLessThan(EDGE_TOLERANCE);
    }
  });

  it('fits the largest radius with transitions where none is given', () => {
    const { segments, problems } = centrelineSegments([[0, 0], [40, 0], [40, 40]], [null], HALF_WIDTH, [10]);
    expect(problems).toEqual([]);
    expect(segments.map((s) => s.type)).toEqual(['CLOTHOID', 'CIRCULARARC', 'CLOTHOID']);
    expect(segments[0].start[0]).toBeCloseTo(0, 6);
    expect(segments[2].end[1]).toBeCloseTo(40, 6);
  });

  it('refuses a transition longer than the bend allows', () => {
    const { problems } = centrelineSegments(BEND, [RADIUS], HALF_WIDTH, [RADIUS * 2]);
    expect(problems.map((p) => p.code)).toEqual(['transition_too_long']);
    expect(problems[0].vertex).toBe(1);
    expect(problems[0].values.maxTransition).toBeCloseTo((RADIUS * Math.PI) / 2, 9);
  });

  it('builds a corridor with transitions, reads them back and keeps the profile along the new stationing', () => {
    const definition: CorridorDefinition = {
      Centreline: BEND, Radii: [RADIUS], Transitions: [TRANSITION], Width: 2 * HALF_WIDTH, CrossFall: 0.025, CrossFallSide: 'camber',
      Profile: [{ Station: 0, Height: 100 }, { Station: 20, Grade: 0.04 }], MaxGrade: 0.12, MinK: 1,
    };
    expect(corridorProblems(definition)).toEqual([]);
    const corridor = buildCorridor(definition);
    expect(corridor.horizontal.map((s) => s.type)).toContain('CLOTHOID');
    expect(corridor.length).toBeCloseTo(centrelineLength(bend()), 9);
    expect(profileAt(corridor.vertical, corridor.length).height).toBeCloseTo(100 + 0.04 * corridor.length, 6);
  });
});
