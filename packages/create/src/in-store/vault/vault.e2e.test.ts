/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { IfcParser } from '@ifc-lite/parser';
import { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import { StepExporter } from '@ifc-lite/export';
import { IfcCreator } from '../../ifc-creator.js';
import { resolveSpatialAnchor } from '../resolve-anchor.js';
import { meshStairs, stairMeshBounds, stairWasmAvailable, type StairMesh } from '../__test__/stair-mesh.oracle.js';
import { addVaultToStore, editVaultInStore, readVaultInStore, type VaultInStoreParams } from './vault.js';

type Schema = 'IFC2X3' | 'IFC4' | 'IFC4X3';

async function model(schema: Schema = 'IFC4', elevation = -2.6) {
  const creator = new IfcCreator({ Schema: schema, Timestamp: 0 });
  const storey = creator.addIfcBuildingStorey({ Name: 'UG1', Elevation: elevation });
  const store = await new IfcParser().parseColumnar(new TextEncoder().encode(creator.toIfc().content).buffer, { disableWorkerScan: true });
  const view = new MutablePropertyView(null, 'm');
  const editor = new StoreEditor(store, view);
  const anchor = resolveSpatialAnchor(store, storey, view);
  const text = () => new TextDecoder().decode(new StepExporter(store, view).export({ schema, applyMutations: true }).content);
  return { store, view, editor, anchor, storey, text };
}

const BARREL: VaultInStoreParams = { Shape: 'barrel', Origin: [1, 2], Width: 6, Depth: 4, Springing: 1.8, Crown: 2.6, Thickness: 0.3 };

function zAt(meshes: readonly StairMesh[], x: number, y: number, tolerance: number): number[] {
  const out: number[] = [];
  for (const mesh of meshes) for (let i = 0; i < mesh.positions.length; i += 3) {
    if (Math.abs(mesh.positions[i] - x) < tolerance && Math.abs(mesh.positions[i + 1] - y) < tolerance) out.push(mesh.positions[i + 2]);
  }
  return out;
}

describe('vaults in the store', () => {
  it('records its definition and reads it back with the placement it stands on', async () => {
    const m = await model();
    const id = addVaultToStore(m.editor, m.anchor, { ...BARREL, XDirection: [0, 1] });
    const read = readVaultInStore(m.store, id, m.storey, m.view);
    expect(read).toMatchObject({ Shape: 'barrel', Width: 6, Depth: 4, Thickness: 0.3, SpanAxis: 'Y' });
    expect(read?.Origin[0]).toBeCloseTo(1, 9);
    expect(read?.XDirection[1]).toBeCloseTo(1, 9);
    expect(read?.Springing).toBeCloseTo(1.8, 9);
    expect(read?.Crown).toBeCloseTo(2.6, 9);
    expect(m.text()).toMatch(/IFCSLAB\('[^']+',[^,]*,'Vault',\$,'VAULT',#\d+,#\d+,\$,\.USERDEFINED\.\)/);
    expect(m.text()).toContain('IFCARCINDEX((');
  });

  it('refuses a crown at or below the springing and non-positive sizes, writing nothing', async () => {
    const m = await model();
    const before = m.text();
    expect(() => addVaultToStore(m.editor, m.anchor, { ...BARREL, Crown: 1.8 })).toThrow(/crown/);
    expect(() => addVaultToStore(m.editor, m.anchor, { ...BARREL, Width: 0 })).toThrow(/Width/);
    expect(() => addVaultToStore(m.editor, m.anchor, { ...BARREL, Thickness: -1 })).toThrow(/Thickness/);
    expect(m.text()).toBe(before);
  });

  it('edits the rise, footprint and shape in place, keeping the slab and its GlobalId', async () => {
    const m = await model();
    const id = addVaultToStore(m.editor, m.anchor, BARREL);
    const guid = m.text().match(/IFCSLAB\('([^']+)'/)?.[1];
    const edited = editVaultInStore(m.store, m.editor, id, m.storey, { Shape: 'cross', Crown: 3, Origin: [0, 0] });
    expect(edited).toMatchObject({ Shape: 'cross', Origin: [0, 0] });
    expect(edited.Rise).toBeCloseTo(1.2, 9);
    expect(m.text().match(/IFCSLAB\('([^']+)'/)?.[1]).toBe(guid);
    expect(m.text()).toContain('IFCPOLYGONALFACESET(');
    expect(m.text()).not.toContain('IFCEXTRUDEDAREASOLID(');
    expect(() => editVaultInStore(m.store, m.editor, id, m.storey, { Crown: 0.5 })).toThrow(/crown/);
  });

  it('retires a replaced cross vault body with its faces, so no orphan IfcIndexedPolygonalFace is left', async () => {
    const m = await model();
    const id = addVaultToStore(m.editor, m.anchor, { ...BARREL, Shape: 'cross' });
    expect(m.text()).toContain('IFCINDEXEDPOLYGONALFACE(');
    editVaultInStore(m.store, m.editor, id, m.storey, { Shape: 'barrel' });
    expect(m.text()).not.toContain('IFCINDEXEDPOLYGONALFACE(');
    expect(m.text()).not.toContain('IFCCARTESIANPOINTLIST3D(');
  });

  for (const schema of ['IFC2X3', 'IFC4X3'] as const) {
    it(`writes a parseable ${schema} body for both shapes`, async () => {
      const m = await model(schema);
      addVaultToStore(m.editor, m.anchor, BARREL);
      addVaultToStore(m.editor, m.anchor, { ...BARREL, Shape: 'cross', Origin: [10, 2] });
      const reparsed = await new IfcParser().parseColumnar(new TextEncoder().encode(m.text()).buffer, { disableWorkerScan: true });
      expect(reparsed.entityIndex.byType.get('IFCSLAB')).toHaveLength(2);
      if (schema === 'IFC2X3') expect(m.text()).toContain('IFCFACETEDBREP(');
    });
  }
});

describe.skipIf(!stairWasmAvailable)('vaults through the wasm geometry pipeline', () => {
  it('meshes a barrel vault over a 4 x 6 m room from its springing to its crown plus thickness', async () => {
    const m = await model('IFC4', 0);
    const id = addVaultToStore(m.editor, m.anchor, BARREL);
    const meshes = (await meshStairs(m.text())).get(id) ?? [];
    const { min, max } = stairMeshBounds(meshes);
    expect(min[0]).toBeCloseTo(1, 3);
    expect(max[0]).toBeCloseTo(7, 3);
    expect(min[1]).toBeCloseTo(2, 3);
    expect(max[1]).toBeCloseTo(6, 3);
    expect(min[2]).toBeCloseTo(1.8, 3);
    expect(max[2]).toBeCloseTo(2.9, 2);
    const crownLine = zAt(meshes, 4, 4, 0.05);
    expect(Math.min(...crownLine.filter((z) => z > 2))).toBeGreaterThan(2.5);
  });

  it('meshes a cross vault whose crown is at the centre and which springs from the corners', async () => {
    const m = await model('IFC4', 0);
    const id = addVaultToStore(m.editor, m.anchor, { ...BARREL, Shape: 'cross' });
    const meshes = (await meshStairs(m.text())).get(id) ?? [];
    const { min, max } = stairMeshBounds(meshes);
    expect(min[2]).toBeCloseTo(1.8, 3);
    expect(max[2]).toBeCloseTo(2.9, 3);
    const centre = zAt(meshes, 4, 4, 1e-3);
    expect(Math.min(...centre)).toBeCloseTo(2.6, 3);
    expect(Math.max(...centre)).toBeCloseTo(2.9, 3);
    for (const [x, y] of [[1, 2], [7, 2], [7, 6], [1, 6]]) expect(Math.min(...zAt(meshes, x, y, 1e-3))).toBeCloseTo(1.8, 3);
  });
});

describe.skipIf(!stairWasmAvailable)('the kernel draws vault curves within the chord tolerance', () => {
  it('meshes a 10 m round barrel whose end-face vertices sit on r and r + t, no chord sagging over 5 mm', async () => {
    const m = await model('IFC4', 0);
    const id = addVaultToStore(m.editor, m.anchor, { Shape: 'barrel', Origin: [0, 0], Width: 3, Depth: 10, Springing: 2, Crown: 7, Thickness: 0.4, SpanAxis: 'Y' });
    const meshes = (await meshStairs(m.text())).get(id) ?? [];
    const face: Array<[number, number]> = [];
    for (const mesh of meshes) for (let i = 0; i < mesh.positions.length; i += 3) {
      if (Math.abs(mesh.positions[i]) < 1e-6) face.push([mesh.positions[i + 1] - 5, mesh.positions[i + 2] - 2]);
    }
    for (const radius of [5, 5.4]) {
      const ring = face.filter(([y, z]) => Math.abs(Math.hypot(y, z) - radius) < 1e-3 && z > 1e-6).map(([y, z]) => Math.atan2(z, y)).sort((p, q) => p - q);
      expect(ring.length).toBeGreaterThan(8);
      const gaps = ring.slice(1).map((t, i) => t - ring[i]).filter((g) => g > 1e-9);
      for (const gap of gaps) expect(radius * (1 - Math.cos(gap / 2))).toBeLessThanOrEqual(0.005);
    }
  });
});
