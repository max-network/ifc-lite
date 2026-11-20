/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Edge breaks through the store: a half-hip roof is recorded with its breaks,
 * survives export, reopen and edits, names its upper planes by edge and stage,
 * and a gable wall attached under it fills up to the half-hip.
 */

import { existsSync, readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extractPropertiesOnDemand } from '@ifc-lite/parser';
import { IfcAPI, initSync } from '@ifc-lite/wasm';
import { addRoofToStore } from './roof.js';
import { addWallToStore } from './wall.js';
import { editFootprintRoofInStore, readFootprintRoofInStore, ROOF_FOOTPRINT_PSET } from './roof-footprint.js';
import { getFootprintRoofPlaneParts } from './roof-plane-parts.js';
import { setTopConstraintInStore } from './storey/storey-top-constraint.js';
import { resolveHostAnchor } from './resolve-host.js';
import { addOpeningToStore } from './opening.js';
import { exportText, insideMesh, meshWalls, newStorey, parse } from './wall-join-mesh.oracle.js';

const D = Math.PI / 180;
const HALF_HIP = {
  Position: [0, 0, 3] as [number, number, number], Width: 10, Depth: 8, Thickness: 0.25,
  EdgeSlopes: [30 * D, 0, 30 * D, 0], EdgeBreaks: [[], [{ Height: 1.5, Slope: 45 * D }], [], [{ Height: 1.5, Slope: 45 * D }]],
};

describe('a roof with edge breaks in a loaded model', () => {
  it.each(['IFC4', 'IFC2X3', 'IFC4X3'] as const)('%s: a half-hip roof records its breaks, names its planes and survives reopening', async (schema) => {
    const s = await newStorey(schema);
    const { roofId } = addRoofToStore(s.editor, s.anchor, HALF_HIP);
    const definition = readFootprintRoofInStore(s.store, roofId, s.view);
    expect(definition?.PredefinedType).toBe('HIPPED_GABLE_ROOF');
    expect(definition?.EdgeBreaks).toEqual(HALF_HIP.EdgeBreaks);
    const tags = getFootprintRoofPlaneParts(s.store, s.view, roofId).map((id) => s.editor.getNewEntity(id)?.attributes[7]);
    expect(tags.sort()).toEqual(['0', '1.1', '2', '3.1']);
    const reopened = await parse(exportText(s));
    const id = reopened.entityIndex.byType.get('IFCROOF')?.[0];
    const names = extractPropertiesOnDemand(reopened, id!).find((set) => set.name === ROOF_FOOTPRINT_PSET)?.properties.map((p) => p.name);
    expect(names?.sort()).toEqual(['EdgeBreaks', 'EdgeSlopes', 'Footprint', 'Overhang', 'Thickness']);
  });

  it('an edit keeps the breaks and their planes; clearing them returns a gable roof without the record', async () => {
    const s = await newStorey();
    const { roofId } = addRoofToStore(s.editor, s.anchor, HALF_HIP);
    const parts = getFootprintRoofPlaneParts(s.store, s.view, roofId);
    let definition = editFootprintRoofInStore(s.store, s.editor, roofId, { Overhang: 0.4 });
    expect(definition.EdgeBreaks).toEqual(HALF_HIP.EdgeBreaks);
    expect(getFootprintRoofPlaneParts(s.store, s.view, roofId).sort()).toEqual([...parts].sort());
    definition = editFootprintRoofInStore(s.store, s.editor, roofId, { EdgeBreaks: [[], [], [], []] });
    expect(definition.PredefinedType).toBe('GABLE_ROOF');
    expect(s.view.getPropertyValue(roofId, ROOF_FOOTPRINT_PSET, 'EdgeBreaks')).toBeNull();
    expect(getFootprintRoofPlaneParts(s.store, s.view, roofId)).toHaveLength(2);
  });

  it('an edit replaces the footprint and keeps the planes, and refuses one whose edges the slopes do not match', async () => {
    const s = await newStorey();
    const { roofId } = addRoofToStore(s.editor, s.anchor, HALF_HIP);
    const parts = getFootprintRoofPlaneParts(s.store, s.view, roofId);
    const footprint: Array<[number, number]> = [[0, 0], [12, 0], [12, 6], [0, 6]];
    const definition = editFootprintRoofInStore(s.store, s.editor, roofId, { Footprint: footprint });
    expect(definition.Footprint).toEqual(footprint);
    expect(definition.EdgeBreaks).toEqual(HALF_HIP.EdgeBreaks);
    expect(readFootprintRoofInStore(s.store, roofId, s.view)?.Footprint).toEqual(footprint);
    expect(getFootprintRoofPlaneParts(s.store, s.view, roofId).sort()).toEqual([...parts].sort());
    expect(() => editFootprintRoofInStore(s.store, s.editor, roofId, { Footprint: [[0, 0], [12, 0], [6, 6]] })).toThrow(/one per footprint edge/);
    expect(readFootprintRoofInStore(s.store, roofId, s.view)?.Footprint).toEqual(footprint);
  });

  it('a rotated slab opening turns its rectangle about the host\'s Z', async () => {
    const s = await newStorey();
    const { roofId } = addRoofToStore(s.editor, s.anchor, { ...HALF_HIP, EdgeBreaks: undefined, EdgeSlopes: [30 * D, 30 * D, 30 * D, 30 * D] });
    const plane = getFootprintRoofPlaneParts(s.store, s.view, roofId)[0];
    const host = resolveHostAnchor(s.store, plane, s.view);
    const result = addOpeningToStore(s.editor, host, { Position: [5, 1.5], Width: 1.2, Depth: 1, Rotation: Math.PI / 2, CutDepth: 4 });
    const placement = s.editor.getNewEntity(result.placementId)!;
    const axes = s.editor.getNewEntity(Number(String(placement.attributes[1]).slice(1)))!;
    const ref = s.editor.getNewEntity(Number(String(axes.attributes[2]).slice(1)))!;
    const [x, y, z] = ref.attributes[0] as number[];
    expect(x).toBeCloseTo(0, 9);
    expect(y).toBeCloseTo(1, 9);
    expect(z).toBe(0);
  });
});

const wasm = new URL('../../../wasm/pkg/ifc-lite_bg.wasm', import.meta.url);
describe.skipIf(!existsSync(wasm))('a gable wall under a half-hip through the mesh kernel (build WASM to run)', () => {
  let api: IfcAPI;
  beforeAll(() => { initSync({ module: readFileSync(wasm) }); api = new IfcAPI(); });
  afterAll(() => api.free());

  it('fills the gable up to the break and stops under the half-hip', async () => {
    const s = await newStorey();
    const roof = addRoofToStore(s.editor, s.anchor, HALF_HIP).roofId;
    const wall = addWallToStore(s.editor, s.anchor, { Start: [9.9, 0, 0], End: [9.9, 8, 0], Height: 3, Thickness: 0.2 }).wallId;
    setTopConstraintInStore(s.store, s.editor, wall, { kind: 'roof', roofId: roof });
    const meshes = meshWalls(api, exportText(s)).get(wall) ?? [];
    expect(meshes.length).toBeGreaterThan(0);
    expect(insideMesh(meshes, [9.9, 3 + 1.55, -4])).toBe(true);
    expect(insideMesh(meshes, [9.9, 3 + 1.65, -4])).toBe(false);
    expect(insideMesh(meshes, [9.9, 3 + Math.tan(30 * D) - 0.05, -1])).toBe(true);
    expect(insideMesh(meshes, [9.9, 3 + Math.tan(30 * D) + 0.05, -1])).toBe(false);
  });
});
