/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { existsSync, readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IfcAPI, initSync } from '@ifc-lite/wasm';
import { addRoofToStore } from './roof.js';
import { addSpaceToStore } from './space.js';
import { translateProduct } from './edit/placement-core.js';
import { resolveSlabEditChain } from './edit/slab-edit.js';
import { existingSpaceFootprintEntriesByStorey } from './space-footprints.js';
import { clearBodyRoofClipInStore, clipBodyToRoofInStore } from './wall-roof-clip.js';
import { exportText, insideMesh, meshProducts, newStorey } from './wall-join-mesh.oracle.js';

const wasm = new URL('../../../wasm/pkg/ifc-lite_bg.wasm', import.meta.url);
const GABLE = { Position: [0, 0, 4] as [number, number, number], Width: 10, Depth: 8, Thickness: .25, EdgeSlopes: [Math.PI / 6, 0, Math.PI / 6, 0], Overhang: .5 };
const ROOM: Array<[number, number]> = [[1, 1], [9, 1], [9, 7], [1, 7]];
const ridge = (y: number, lift = 0) => 4 + lift + Math.min(y, 8 - y) * Math.tan(Math.PI / 6);

async function underGable() {
  const s = await newStorey();
  const roof = addRoofToStore(s.editor, s.anchor, GABLE).roofId;
  const space = addSpaceToStore(s.editor, s.anchor, { Profile: 'polygon', OuterCurve: ROOM, Position: [0, 0, 0], Height: 8, Name: 'Attic' }).spaceId;
  return { ...s, roof, space };
}

const booleans = (text: string) => (text.match(/=IFCBOOLEANRESULT\(/g) ?? []).length;

describe.skipIf(!existsSync(wasm))('a body cut to a roof by footprint (build WASM to run)', () => {
  let api: IfcAPI;
  beforeAll(() => { initSync({ module: readFileSync(wasm) }); api = new IfcAPI(); });
  afterAll(() => api.free());

  it('a space stops at both slopes of a gable underside and keeps its footprint and editable extrusion', async () => {
    const s = await underGable();
    const footprint = existingSpaceFootprintEntriesByStorey(s.store, s.view).get(s.storeyId)?.[0]?.footprint;
    const solid = resolveSlabEditChain(s.store, s.view, s.editor, s.space)?.extrudedSolidId;
    expect(clipBodyToRoofInStore(s.store, s.editor, s.space, s.roof)).toBe(true);
    const meshes = meshProducts(api, exportText(s), ['IfcSpace']).get(s.space) ?? [];
    for (const y of [1.5, 3, 4, 5, 6.5]) {
      expect(insideMesh(meshes, [5, ridge(y) - .03, -y]), `fills to the underside at y=${y}`).toBe(true);
      expect(insideMesh(meshes, [5, ridge(y) + .03, -y]), `stops at the underside at y=${y}`).toBe(false);
    }
    expect(existingSpaceFootprintEntriesByStorey(s.store, s.view).get(s.storeyId)?.[0]?.footprint).toEqual(footprint);
    expect(resolveSlabEditChain(s.store, s.view, s.editor, s.space)?.extrudedSolidId).toBe(solid);
  });

  it('an unchanged roof writes nothing, a moved one replaces the cut, and clearing restores the extrusion', async () => {
    const s = await underGable();
    clipBodyToRoofInStore(s.store, s.editor, s.space, s.roof);
    const count = s.view.getMutationCount();
    expect(clipBodyToRoofInStore(s.store, s.editor, s.space, s.roof)).toBe(false);
    expect(s.view.getMutationCount()).toBe(count);
    const cut = booleans(exportText(s));
    expect(translateProduct(s.store, s.view, s.editor, s.roof, [0, 0, 1]).ok).toBe(true);
    expect(clipBodyToRoofInStore(s.store, s.editor, s.space, s.roof)).toBe(true);
    const text = exportText(s);
    expect(booleans(text)).toBe(cut);
    const meshes = meshProducts(api, text, ['IfcSpace']).get(s.space) ?? [];
    expect(insideMesh(meshes, [5, ridge(4, 1) - .03, -4])).toBe(true);
    expect(insideMesh(meshes, [5, ridge(4, 1) + .03, -4])).toBe(false);
    expect(clearBodyRoofClipInStore(s.store, s.editor, s.space)).toBe(true);
    const plain = exportText(s);
    expect(booleans(plain)).toBe(0);
    expect(insideMesh(meshProducts(api, plain, ['IfcSpace']).get(s.space) ?? [], [5, 7.9, -1.5])).toBe(true);
    expect(clearBodyRoofClipInStore(s.store, s.editor, s.space)).toBe(false);
  });

  it('refuses, writing nothing, a roof that does not cover the whole body', async () => {
    const s = await newStorey();
    const roof = addRoofToStore(s.editor, s.anchor, GABLE).roofId;
    const space = addSpaceToStore(s.editor, s.anchor, { Profile: 'polygon', OuterCurve: [[1, 1], [14, 1], [14, 7], [1, 7]], Position: [0, 0, 0], Height: 8 }).spaceId;
    const count = s.view.getMutationCount();
    expect(() => clipBodyToRoofInStore(s.store, s.editor, space, roof)).toThrow(/does not cover/);
    expect(s.view.getMutationCount()).toBe(count);
  });
});
