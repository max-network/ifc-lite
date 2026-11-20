/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Gable walls under a half-hip through the mesh kernel: neither a wall nor a
 * roof plane may reach above the roof, or out past its eaves, where the
 * half-hip meets the gable.
 */

import { existsSync, readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IfcAPI, initSync } from '@ifc-lite/wasm';
import { addRoofToStore, type RoofPolygonParams } from './roof.js';
import { addWallToStore } from './wall.js';
import { setTopConstraintInStore } from './storey/storey-top-constraint.js';
import { heightAt, planFootprintRoof, type FootprintRoofPlan, type PlanPoint, type RoofEdgeBreak } from './roof-footprint-plan.js';
import { exportText, meshProducts, newStorey, type Mesh } from './wall-join-mesh.oracle.js';

const D = Math.PI / 180;
const MM = 1e-3;
const E = 0.2175, BASE = 2.75, THICKNESS = 0.24, OVERHANG = 0.6, WALL = 0.435;
const FOOTPRINT: Array<[number, number]> = [[-E, -E], [12 + E, -E], [12 + E, 9 + E], [-E, 9 + E]];

function roofOf(pitch: number, halfHip: number): RoofPolygonParams & { EdgeSlopes: number[]; EdgeBreaks: RoofEdgeBreak[][] } {
  const peak = (4.5 + E) * Math.tan(pitch * D);
  const turn: RoofEdgeBreak[] = halfHip > 0 ? [{ Height: peak - halfHip, Slope: pitch * D }] : [];
  return {
    Profile: 'polygon', OuterCurve: FOOTPRINT, Position: [0, 0, BASE], Thickness: THICKNESS, Overhang: OVERHANG,
    EdgeSlopes: [pitch * D, 0, pitch * D, 0], EdgeBreaks: [[], turn, [], turn],
  };
}

/** The underside of a convex roof by footprint: the lowest of its planes. */
const underside = (plan: FootprintRoofPlan, p: PlanPoint) => Math.min(...plan.planes.map((plane) => heightAt(plane, p)));

function within(outline: readonly PlanPoint[], p: PlanPoint, tolerance: number): boolean {
  return outline.every((a, i) => {
    const b = outline[(i + 1) % outline.length], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return ((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) / length <= tolerance;
  });
}

/** World Z-up points of meshes the kernel gives Y-up. */
function points(meshes: readonly Mesh[]): Array<[number, number, number]> {
  return meshes.flatMap(({ positions }) => Array.from({ length: positions.length / 3 }, (_, k): [number, number, number] => [positions[3 * k], -positions[3 * k + 2], positions[3 * k + 1]]));
}

const wasm = new URL('../../../wasm/pkg/ifc-lite_bg.wasm', import.meta.url);
describe.skipIf(!existsSync(wasm))('gable walls under a half-hip through the mesh kernel (build WASM to run)', () => {
  let api: IfcAPI;
  beforeAll(() => { initSync({ module: readFileSync(wasm) }); api = new IfcAPI(); });
  afterAll(() => api.free());

  it.each([[40, 1.2], [45, 1.5], [40, 0]])('a %i° roof with a %f m half-hip: no wall or roof point above the roof or past its eaves', async (pitch, halfHip) => {
    const s = await newStorey();
    const roof = roofOf(pitch, halfHip);
    const roofId = addRoofToStore(s.editor, s.anchor, roof).roofId;
    const walls = [12, 0].map((x) => addWallToStore(s.editor, s.anchor, { Start: [x, 0, 0], End: [x, 9, 0], Height: BASE, Thickness: WALL }).wallId);
    for (const wall of walls) setTopConstraintInStore(s.store, s.editor, wall, { kind: 'roof', roofId });
    const plan = planFootprintRoof(FOOTPRINT, roof.EdgeSlopes, OVERHANG, roof.EdgeBreaks);
    const top = THICKNESS / Math.cos(pitch * D);
    const meshes = meshProducts(api, exportText(s), ['IfcWall', 'IfcSlab']);
    const parts = [...meshes.keys()].filter((id) => !walls.includes(id));
    expect(parts.length).toBe(halfHip > 0 ? 4 : 2);
    for (const [id, own] of meshes) {
      const wall = walls.includes(id);
      for (const p of points(own)) {
        const at = `${wall ? 'wall' : 'roof plane'} #${id} at ${p.map((v) => v.toFixed(3)).join(', ')}`;
        expect(p[2], `${at} is above the ridge`).toBeLessThanOrEqual(BASE + plan.rise + (wall ? 0 : top) + MM);
        expect(within(plan.eaves, [p[0], p[1]], MM), `${at} is past the eaves`).toBe(true);
        expect(p[2], `${at} is above the roof`).toBeLessThanOrEqual(BASE + underside(plan, [p[0], p[1]]) + (wall ? 0 : top) + MM);
      }
    }
  });
});
