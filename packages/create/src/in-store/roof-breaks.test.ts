/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Edge breaks on a roof by footprint: an edge whose slope changes at a height.
 * A gable end turning sloped is a half-hip (jerkinhead), a steep slope turning
 * shallower a mansard, and with gable ends a gambrel. Checked against the
 * invariants of any roof: the planes tile the eaves, every corner shared by
 * two planes has one height, and each plane rises at its own slope.
 */

import { describe, expect, it } from 'vitest';
import { heightAt, planFootprintRoof, roofPlaneTag, signedArea, type FootprintRoofPlan, type PlanPoint } from './roof-footprint-plan.js';
import { weightedStraightSkeleton } from './roof-skeleton.js';

const D = Math.PI / 180;
const RECT: PlanPoint[] = [[0, 0], [10, 0], [10, 8], [0, 8]];
const SQUARE: PlanPoint[] = [[0, 0], [8, 0], [8, 8], [0, 8]];

function expectTiledAndWatertight(plan: FootprintRoofPlan) {
  const tiled = plan.planes.reduce((sum, plane) => sum + signedArea(plane.outline), 0);
  expect(tiled).toBeCloseTo(signedArea(plan.eaves), 9);
  const corners = plan.planes.flatMap((plane) => plane.outline.map((p) => ({ p, z: heightAt(plane, p) })));
  for (const a of corners) {
    for (const b of corners) {
      if (Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1]) < 1e-7) expect(Math.abs(a.z - b.z)).toBeLessThan(1e-7);
    }
  }
}

describe('roof edge breaks', () => {
  it('a half-hip (Krüppelwalm) keeps the gable wall up to its break and hips the top', () => {
    const plan = planFootprintRoof(RECT, [30 * D, 0, 30 * D, 0], 0, [[], [{ Height: 1.5, Slope: 45 * D }], [], [{ Height: 1.5, Slope: 45 * D }]]);
    expect(plan.shapeType).toBe('HIPPED_GABLE_ROOF');
    expect(plan.planes.map(roofPlaneTag).sort()).toEqual(['0', '1.1', '2', '3.1']);
    expect(plan.rise).toBeCloseTo(4 * Math.tan(30 * D), 9);
    for (const hip of plan.planes.filter((plane) => plane.stage === 1)) {
      const heights = hip.outline.map((p) => heightAt(hip, p));
      expect(Math.min(...heights)).toBeCloseTo(1.5, 9);
      expect(Math.max(...heights)).toBeCloseTo(plan.rise, 9);
    }
    expectTiledAndWatertight(plan);
  });

  it('a half-hip under an overhang starts its hip on the rake at the break height', () => {
    const plan = planFootprintRoof(RECT, [30 * D, 0, 30 * D, 0], 0.5, [[], [{ Height: 1.5, Slope: 45 * D }], [], []]);
    const hip = plan.planes.find((plane) => plane.stage === 1)!;
    const low = hip.outline.filter((p) => Math.abs(heightAt(hip, p) - 1.5) < 1e-9);
    expect(low.every((p) => Math.abs(p[0] - 10.5) < 1e-9)).toBe(true);
    expectTiledAndWatertight(plan);
  });

  it('a mansard rises steeply to its break, then shallower to a hip ridge', () => {
    const plan = planFootprintRoof(RECT, RECT.map(() => 70 * D), 0, RECT.map(() => [{ Height: 2.5, Slope: 25 * D }]));
    expect(plan.shapeType).toBe('MANSARD_ROOF');
    expect(plan.planes).toHaveLength(8);
    const inset = 2.5 / Math.tan(70 * D);
    expect(plan.rise).toBeCloseTo(2.5 + (4 - inset) * Math.tan(25 * D), 9);
    expectTiledAndWatertight(plan);
  });

  it('two pitches with gable ends is a gambrel', () => {
    const plan = planFootprintRoof(RECT, [60 * D, 0, 60 * D, 0], 0.3, [[{ Height: 2, Slope: 25 * D }], [], [{ Height: 2, Slope: 25 * D }], []]);
    expect(plan.shapeType).toBe('GAMBREL_ROOF');
    expect(plan.planes).toHaveLength(4);
    expectTiledAndWatertight(plan);
  });

  it('equal pitches meeting in one apex are a pavilion roof, a ridge makes it a hip roof', () => {
    expect(planFootprintRoof(SQUARE, SQUARE.map(() => 30 * D), 0).shapeType).toBe('PAVILION_ROOF');
    expect(planFootprintRoof(RECT, RECT.map(() => 30 * D), 0).shapeType).toBe('HIP_ROOF');
  });

  it('a hip on one end and a gable on the other is freeform', () => {
    const plan = planFootprintRoof(RECT, [30 * D, 30 * D, 30 * D, 0], 0.5);
    expect(plan.shapeType).toBe('FREEFORM');
    expect(plan.planes).toHaveLength(3);
    expectTiledAndWatertight(plan);
  });

  it('a fall of 5° or less is a flat roof', () => {
    expect(planFootprintRoof(RECT, [3 * D, 0, 0, 0], 0).shapeType).toBe('FLAT_ROOF');
    expect(planFootprintRoof(RECT, [8 * D, 0, 0, 0], 0).shapeType).toBe('SHED_ROOF');
  });

  it('an L hip with a half-hipped wing end still tiles and closes its valley', () => {
    const L: PlanPoint[] = [[0, 0], [12, 0], [12, 6], [6, 6], [6, 12], [0, 12]];
    const slopes = L.map((_, i) => (i === 3 ? 0 : 35 * D));
    const plan = planFootprintRoof(L, slopes, 0, L.map((_, i) => (i === 3 ? [{ Height: 1.2, Slope: 50 * D }] : [])));
    expect(plan.planes.some((plane) => plane.edge === 3 && plane.stage === 1)).toBe(true);
    expectTiledAndWatertight(plan);
  });

  it('refuses breaks that do not climb, or a list per edge that does not fit', () => {
    expect(() => planFootprintRoof(RECT, RECT.map(() => 60 * D), 0, RECT.map(() => [{ Height: 0, Slope: 20 * D }]))).toThrow(/above the eaves/);
    expect(() => planFootprintRoof(RECT, RECT.map(() => 60 * D), 0, [[], []])).toThrow(/one list/);
    expect(() => planFootprintRoof(RECT, RECT.map(() => 60 * D), 0, RECT.map(() => [{ Height: 2, Slope: 30 }]))).toThrow(/radians/);
    expect(() => planFootprintRoof(RECT, [0, 0, 0, 0], 0, [[{ Height: 1, Slope: 30 * D }], [], [], []])).toThrow(/gable end/);
  });

  it('the skeleton closes a changed line\'s face along the wavefront where it changes', () => {
    const lines = [
      { nx: 0, ny: 1, k: 0, s: 1 }, { nx: -1, ny: 0, k: -10, s: 0 }, { nx: 0, ny: -1, k: -8, s: 1 }, { nx: 1, ny: 0, k: 0, s: 0 },
    ];
    const faces = weightedStraightSkeleton(lines, [{ line: 1, at: 2, s: 1 }, { line: 3, at: 9, s: 1 }]);
    expect(faces).toHaveLength(6);
    expect(faces[4].length).toBeGreaterThanOrEqual(3);
    expect(Math.min(...faces[4].map((p) => p[2]))).toBeCloseTo(2, 9);
    expect(faces[5]).toEqual([]);
  });
});
