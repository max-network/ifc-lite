/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { corridorProfile, profileAt } from './profile.js';

const STEP_LIMIT = 1e-3;
const SLOPE_LIMIT = 1e-6;
const EPS = 1e-9;

const RISING = [
  { Station: 0, Height: 100 },
  { Station: 45, Grade: 0.04 },
  { Station: 60, Grade: 0.08 },
];

describe('corridorProfile', () => {
  it('rises 3 m over 60 m at 4 % then 8 % with a parabola of L = K·|Δg| between', () => {
    const result = corridorProfile(RISING, 60, { maxGrade: 0.12, minK: 5 });
    expect(result.problems).toEqual([]);
    expect(result.curves).toHaveLength(1);
    const [curve] = result.curves;
    expect(curve.length).toBeCloseTo(5 * 4, 12);
    expect(profileAt(result.segments, 60).height).toBeCloseTo(103, 12);
    expect(result.grades.map((g) => g.grade)).toEqual([0.04, 0.08].map((g) => expect.closeTo(g, 12)));

    const bvc = 45 - curve.length / 2;
    const zBvc = 100 + 0.04 * bvc;
    for (let x = 0; x <= curve.length; x += 0.25) {
      const expected = zBvc + 0.04 * x + ((0.08 - 0.04) * x * x) / (2 * curve.length);
      expect(Math.abs(profileAt(result.segments, bvc + x).height - expected)).toBeLessThan(EPS);
    }
    expect(profileAt(result.segments, 45).height).toBeCloseTo(101.8 + (0.04 * curve.length) / 8, 9);
  });

  it('is continuous in height and slope across both ends of the vertical curve', () => {
    const result = corridorProfile(RISING, 60, { maxGrade: 0.12, minK: 5 });
    const [curve] = result.curves;
    for (const join of [curve.start, curve.start + curve.length]) {
      const before = profileAt(result.segments, join - 1e-7);
      const after = profileAt(result.segments, join + 1e-7);
      expect(Math.abs(after.height - before.height)).toBeLessThan(STEP_LIMIT);
      expect(Math.abs(after.gradient - before.gradient)).toBeLessThan(SLOPE_LIMIT);
    }
    let previous = profileAt(result.segments, 0);
    for (let s = 0.01; s <= 60; s += 0.01) {
      const here = profileAt(result.segments, s);
      expect(Math.abs(here.height - previous.height)).toBeLessThan(0.08 * 0.01 + STEP_LIMIT);
      expect(Math.abs(here.gradient - previous.gradient)).toBeLessThan((0.04 / curve.length) * 0.01 + SLOPE_LIMIT);
      previous = here;
    }
  });

  it('keeps an explicit curve length that is long enough', () => {
    const result = corridorProfile([RISING[0], { ...RISING[1], CurveLength: 24 }, RISING[2]], 60, { maxGrade: 0.12, minK: 5 });
    expect(result.problems).toEqual([]);
    expect(result.curves[0].length).toBe(24);
  });

  it('extends the end grades to the street ends', () => {
    const result = corridorProfile([{ Station: 10, Height: 5 }, { Station: 20, Height: 6 }], 40, { maxGrade: 0.2, minK: 1 });
    expect(result.problems).toEqual([]);
    expect(profileAt(result.segments, 0).height).toBeCloseTo(4, 12);
    expect(profileAt(result.segments, 40).height).toBeCloseTo(8, 12);
  });

  it('keeps a single point level over the whole street', () => {
    const result = corridorProfile([{ Station: 0, Height: 2 }], 25, { maxGrade: 0.1, minK: 1 });
    expect(result.problems).toEqual([]);
    expect(profileAt(result.segments, 25).height).toBe(2);
  });

  it('refuses a grade steeper than the maximum', () => {
    const result = corridorProfile(RISING, 60, { maxGrade: 0.06, minK: 5 });
    expect(result.problems).toEqual([{ code: 'grade_too_steep', station: 45, values: { grade: expect.closeTo(0.08, 12), maxGrade: 0.06 } }]);
  });

  it('refuses a curve shorter than K·|Δg|', () => {
    const result = corridorProfile([RISING[0], { ...RISING[1], CurveLength: 10 }, RISING[2]], 60, { maxGrade: 0.12, minK: 5 });
    expect(result.problems).toEqual([{ code: 'curve_too_short', station: 45, values: { length: 10, minLength: expect.closeTo(20, 12) } }]);
  });

  it('refuses a curve that does not fit between its neighbours', () => {
    const result = corridorProfile(RISING, 60, { maxGrade: 0.12, minK: 10 });
    expect(result.problems.map((p) => p.code)).toEqual(['curve_does_not_fit']);
    expect(result.problems[0].values.room).toBeCloseTo(30, 12);
  });

  it('refuses stations outside the street and stations out of order', () => {
    expect(corridorProfile([{ Station: 0, Height: 0 }, { Station: 70, Height: 1 }], 60, { maxGrade: 1, minK: 1 }).problems)
      .toEqual([{ code: 'station_outside', station: 70, values: { length: 60 } }]);
    expect(corridorProfile([{ Station: 20, Height: 0 }, { Station: 10, Height: 1 }], 60, { maxGrade: 1, minK: 1 }).problems.map((p) => p.code))
      .toEqual(['stations_not_ascending']);
  });

  it('needs a height at the first point', () => {
    expect(corridorProfile([{ Station: 0, Grade: 0.02 }], 10, { maxGrade: 1, minK: 1 }).problems.map((p) => p.code)).toEqual(['missing_height']);
  });
});
