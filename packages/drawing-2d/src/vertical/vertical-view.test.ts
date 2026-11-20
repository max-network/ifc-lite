/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import type { MeshData } from '@ifc-lite/geometry';
import type { RenderFrameInfo } from '@ifc-lite/geometry/world-frame';
import type { DrawingLine } from '../types.js';
import { generateElevation, generateVerticalSection, type VerticalView } from './vertical-view.js';

type World = [number, number, number];

const FRAME: RenderFrameInfo = { originShift: { x: 100, y: 5, z: -50 } };
const SHIFT = { x: 100, y: 5, z: -50 };
const BASEMENT = 2;

/** An IFC world (Z up) point in the render frame of {@link FRAME}. */
function render([x, y, z]: World): World {
  return [x - SHIFT.x, z - SHIFT.y, -y - SHIFT.z];
}

function mesh(expressId: number, ifcType: string, corners: World[], indices: number[]): MeshData {
  return {
    expressId,
    ifcType,
    modelIndex: 0,
    positions: new Float32Array(corners.flatMap(render)),
    normals: new Float32Array(corners.length * 3),
    indices: new Uint32Array(indices),
    color: [1, 1, 1, 1],
  };
}

function box(expressId: number, min: World, max: World): MeshData {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const corners: World[] = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const faces = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
  return mesh(expressId, 'IfcWall', corners, faces);
}

/** Ground falling to the south: -3 m up to the building's south face, rising to -0.6 m at its north face, flat beyond; no terrain under the building. */
const groundAt = (y: number) => (y <= 0 ? -3 : y >= 8 ? -0.6 : -3 + 0.3 * y);

function terrain(): MeshData {
  const xs = [-10, 0, 10, 20];
  const ys = [-10, 0, 8, 18];
  const corners: World[] = ys.flatMap((y) => xs.map((x): World => [x, y, groundAt(y)]));
  const indices: number[] = [];
  const at = (i: number, j: number) => j * xs.length + i;
  for (let j = 0; j + 1 < ys.length; j++) {
    for (let i = 0; i + 1 < xs.length; i++) {
      const under = xs[i] >= 0 && xs[i + 1] <= 10 && ys[j] >= 0 && ys[j + 1] <= 8;
      if (!under) indices.push(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i, j + 1));
    }
  }
  return mesh(9, 'IfcGeographicElement', corners, indices);
}

const SCENE: MeshData[] = [box(1, [0, 0, 0], [10, 8, 6]), box(BASEMENT, [0, 0, -3], [10, 8, 0]), terrain()];

const of = (view: VerticalView, id: number) => view.lines.filter((line) => line.entityId === id);
const ys = (lines: readonly DrawingLine[]) => lines.flatMap((l) => [l.line.start.y, l.line.end.y]);
const xs = (lines: readonly DrawingLine[]) => lines.flatMap((l) => [l.line.start.x, l.line.end.x]);

function heightAt(view: VerticalView, x: number): number | null {
  for (const run of view.terrain) {
    for (let k = 1; k < run.length; k++) {
      const [a, b] = [run[k - 1], run[k]];
      if ((x - a.x) * (x - b.x) <= 0 && a.x !== b.x) return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
    }
  }
  return null;
}

describe('generateElevation', () => {
  it('draws the south elevation in IFC world coordinates: x east, y the height', async () => {
    const south = await generateElevation(SCENE, { direction: { x: 0, y: 1 }, frame: FRAME });
    expect(south.right.x).toBeCloseTo(1);
    expect(south.right.y).toBeCloseTo(0);
    const ground = of(south, 1);
    expect(Math.min(...xs(ground))).toBeCloseTo(0, 2);
    expect(Math.max(...xs(ground))).toBeCloseTo(10, 2);
    expect(Math.max(...ys(ground))).toBeCloseTo(6, 2);
    expect(south.planeOffset).toBeLessThan(0);
  });

  it('shows the basement above the garden on the downhill side', async () => {
    const south = await generateElevation(SCENE, { direction: { x: 0, y: 1 }, frame: FRAME });
    expect(heightAt(south, 5)).toBeCloseTo(-3, 2);
    const basement = of(south, BASEMENT);
    expect(basement.length).toBeGreaterThan(0);
    expect(basement.every((line) => line.visibility === 'visible')).toBe(true);
    expect(Math.min(...ys(basement))).toBeCloseTo(-3, 2);
  });

  it('dashes the basement below the ground on the uphill side', async () => {
    const north = await generateElevation(SCENE, { direction: { x: 0, y: -1 }, frame: FRAME });
    expect(north.right.x).toBeCloseTo(-1);
    expect(heightAt(north, -5)).toBeCloseTo(-0.6, 2);
    const basement = of(north, BASEMENT);
    const buried = basement.filter((line) => line.visibility === 'hidden');
    expect(buried.length).toBeGreaterThan(0);
    expect(Math.max(...ys(buried))).toBeLessThanOrEqual(-0.6 + 0.05);
    expect(basement.filter((line) => line.visibility === 'visible').every((line) => Math.min(line.line.start.y, line.line.end.y) >= -0.6 - 0.05)).toBe(true);
  });

  it('runs an east elevation north to the right, the ground rising along the side wall', async () => {
    const east = await generateElevation(SCENE, { direction: { x: -1, y: 0 }, frame: FRAME });
    expect(east.right.y).toBeCloseTo(1);
    expect(heightAt(east, 4)).toBeCloseTo(groundAt(4), 2);
    expect(heightAt(east, 9.5)).toBeCloseTo(-0.6, 2);
  });

  it('looks along any horizontal direction', async () => {
    const view = await generateElevation(SCENE, { direction: { x: 1, y: 1 }, frame: FRAME });
    expect(Math.hypot(view.right.x, view.right.y)).toBeCloseTo(1);
    expect(view.right.x).toBeCloseTo(Math.SQRT1_2);
    expect(view.right.y).toBeCloseTo(-Math.SQRT1_2);
    expect(of(view, 1).length).toBeGreaterThan(0);
  });
});

describe('generateVerticalSection', () => {
  it('cuts the building and the terrain at the plane', async () => {
    const section = await generateVerticalSection(SCENE, { direction: { x: 0, y: 1 }, through: { x: 5, y: 4 }, frame: FRAME });
    expect(section.planeOffset).toBeCloseTo(4, 3);
    const cuts = section.cutPolygons.filter((polygon) => polygon.entityId === 1 || polygon.entityId === BASEMENT);
    expect(cuts.length).toBeGreaterThanOrEqual(2);
    const cutYs = cuts.flatMap((polygon) => polygon.polygon.outer.map((p) => p.y));
    expect(Math.min(...cutYs)).toBeCloseTo(-3, 2);
    expect(Math.max(...cutYs)).toBeCloseTo(6, 2);
    expect(section.terrainCut.length).toBeGreaterThan(0);
    for (const line of section.terrainCut) {
      expect(line.start.y).toBeCloseTo(groundAt(4), 2);
      expect(line.end.y).toBeCloseTo(groundAt(4), 2);
    }
  });
});
