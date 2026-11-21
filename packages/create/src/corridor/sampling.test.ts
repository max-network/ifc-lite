/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { centrelineLength, centrelineSegments, horizontalAt } from './horizontal.js';
import { corridorProfile, profileAt } from './profile.js';
import { arcStep, corridorStations, parabolaStep } from './sampling.js';

const TOLERANCE = 0.005;

function chordDeviation(a: readonly [number, number], b: readonly [number, number], p: readonly [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  return Math.abs(dx * (p[1] - a[1]) - dy * (p[0] - a[0])) / Math.hypot(dx, dy);
}

describe('step bounds', () => {
  it('gives the arc step whose sagitta r(1 − cos(Δθ/2)) is the tolerance', () => {
    const r = 12;
    const step = arcStep(r, TOLERANCE);
    expect(r * (1 - Math.cos(step / r / 2))).toBeCloseTo(TOLERANCE, 12);
  });

  it('gives the parabola step whose chord deviation |Δg|·Δx²/(8L) is the tolerance', () => {
    const step = parabolaStep(20, 0.04, TOLERANCE);
    expect((0.04 * step * step) / (8 * 20)).toBeCloseTo(TOLERANCE, 12);
  });
});

describe('corridorStations', () => {
  const { segments } = centrelineSegments([[0, 0], [30, 0], [30, 30]], [12], 3);
  const length = centrelineLength(segments);
  const profile = corridorProfile([{ Station: 0, Height: 0 }, { Station: 25, Grade: 0.04 }, { Station: length, Grade: 0.1 }], length, { maxGrade: 0.12, minK: 4 });

  it('keeps every outer-edge chord within the tolerance of the arc', () => {
    const offset = 3;
    const { stations, tolerance } = corridorStations(segments, profile.segments, length, { maxOffset: offset, tolerance: TOLERANCE });
    expect(tolerance).toBe(TOLERANCE);
    const edge = (s: number): [number, number] => {
      const f = horizontalAt(segments, s);
      return [f.x - Math.sin(f.direction) * offset, f.y + Math.cos(f.direction) * offset];
    };
    let worst = 0;
    stations.slice(1).forEach((b, i) => {
      const a = stations[i];
      for (let k = 1; k < 20; k++) worst = Math.max(worst, chordDeviation(edge(a), edge(b), edge(a + ((b - a) * k) / 20)));
    });
    expect(worst).toBeLessThanOrEqual(TOLERANCE + 1e-9);
    expect(worst).toBeGreaterThan(TOLERANCE / 4);
  });

  it('keeps the profile within the tolerance of its chords', () => {
    const { stations } = corridorStations(segments, profile.segments, length, { maxOffset: 3, tolerance: TOLERANCE });
    let worst = 0;
    stations.slice(1).forEach((b, i) => {
      const a = stations[i];
      const za = profileAt(profile.segments, a).height;
      const zb = profileAt(profile.segments, b).height;
      for (let k = 1; k < 20; k++) {
        const s = a + ((b - a) * k) / 20;
        worst = Math.max(worst, Math.abs(profileAt(profile.segments, s).height - (za + ((zb - za) * k) / 20)));
      }
    });
    expect(worst).toBeLessThanOrEqual(TOLERANCE + 1e-9);
  });

  it('puts a station on every segment boundary and ascends from 0 to the length', () => {
    const { stations } = corridorStations(segments, profile.segments, length, { maxOffset: 3, tolerance: TOLERANCE });
    expect(stations[0]).toBe(0);
    expect(stations[stations.length - 1]).toBe(length);
    let along = 0;
    const horizontalStarts = segments.map((segment) => {
      const start = along;
      along += segment.length;
      return start;
    });
    const boundaries = [...horizontalStarts, ...profile.segments.map((v) => v.startDistAlong)];
    for (const boundary of boundaries) expect(stations.some((s) => Math.abs(s - boundary) < 1e-9)).toBe(true);
    stations.slice(1).forEach((s, i) => expect(s).toBeGreaterThan(stations[i]));
  });

  it('caps the station count and reports the tolerance it could keep', () => {
    const { stations, tolerance } = corridorStations(segments, profile.segments, length, { maxOffset: 3, tolerance: 1e-7, maxStations: 200 });
    expect(stations.length).toBeLessThanOrEqual(200);
    expect(tolerance).toBeGreaterThan(1e-7);
  });
});
