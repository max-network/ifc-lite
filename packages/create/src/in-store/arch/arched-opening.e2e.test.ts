/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { IfcParser } from '@ifc-lite/parser';
import { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import { StepExporter } from '@ifc-lite/export';
import { IfcCreator } from '../../ifc-creator.js';
import { resolveSpatialAnchor } from '../resolve-anchor.js';
import { addWallToStore } from '../wall.js';
import { addHostedElementInStore } from '../hosted-element.js';
import { editHostedElementInStore } from '../hosted-element-edit.js';
import { placedBodyExtent } from '../resolve-host.js';
import { readHostedFill } from '../hosted-fill-read.js';
import { meshStairs, stairMeshBounds, stairWasmAvailable, type StairMesh } from '../__test__/stair-mesh.oracle.js';
import { readOpeningHead } from './opening-head.js';

type Schema = 'IFC2X3' | 'IFC4' | 'IFC4X3';

async function model(schema: Schema = 'IFC4') {
  const creator = new IfcCreator({ Schema: schema, Timestamp: 0 });
  const storey = creator.addIfcBuildingStorey({ Name: 'UG1', Elevation: 0 });
  const store = await new IfcParser().parseColumnar(new TextEncoder().encode(creator.toIfc().content).buffer, { disableWorkerScan: true });
  const view = new MutablePropertyView(null, 'm');
  const editor = new StoreEditor(store, view);
  const wall = addWallToStore(editor, resolveSpatialAnchor(store, storey, view), { Start: [0, 0, 0], End: [8, 0, 0], Height: 3, Thickness: 0.24 }).wallId;
  const text = () => new TextDecoder().decode(new StepExporter(store, view).export({ schema, applyMutations: true }).content);
  return { store, view, editor, wall, text };
}

const ROUND_WINDOW = { Offset: 2, Sill: 0.9, Width: 1.2, Height: 2, Head: { Shape: 'round' as const } };

function volume(meshes: readonly StairMesh[]): number {
  let total = 0;
  for (const { positions: p, indices } of meshes) for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t] * 3, indices[t + 1] * 3, indices[t + 2] * 3];
    total += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6;
  }
  return Math.abs(total);
}

describe('arched openings', () => {
  it('cuts a round-headed window up to its crown and reads the head back from the profile', async () => {
    const m = await model();
    const window = addHostedElementInStore(m.store, m.editor, m.wall, { kind: 'window', params: ROUND_WINDOW });
    const extent = placedBodyExtent(m.store, window.openingId, m.view);
    expect(extent?.min[2]).toBeCloseTo(0.9, 9);
    expect(extent?.max[2]).toBeCloseTo(2.9, 9);
    expect(readOpeningHead(m.store, window.openingId, m.view)?.head).toEqual({ Shape: 'round' });
    expect(m.text()).toContain('IFCARCINDEX((');
    expect(m.text()).toContain('IFCARBITRARYPROFILEDEFWITHVOIDS(');
    const reparsed = await new IfcParser().parseColumnar(new TextEncoder().encode(m.text()).buffer, { disableWorkerScan: true });
    expect(readOpeningHead(reparsed, window.openingId)?.rise).toBeCloseTo(0.6, 9);
  });

  it('reads a segmental head with its rise', async () => {
    const m = await model();
    const door = addHostedElementInStore(m.store, m.editor, m.wall, { kind: 'door', params: { Offset: 5, Width: 1.1, Height: 2.3, Head: { Shape: 'segmental', Rise: 0.25 } } });
    expect(readOpeningHead(m.store, door.openingId, m.view)).toMatchObject({ head: { Shape: 'segmental' } });
    expect(readOpeningHead(m.store, door.openingId, m.view)?.rise).toBeCloseTo(0.25, 9);
  });

  it('refuses a rise larger than half the width or the height, writing nothing', async () => {
    const m = await model();
    const before = m.text();
    expect(() => addHostedElementInStore(m.store, m.editor, m.wall, { kind: 'window', params: { ...ROUND_WINDOW, Head: { Shape: 'segmental', Rise: 0.7 } } })).toThrow(/half the width/);
    expect(() => addHostedElementInStore(m.store, m.editor, m.wall, { kind: 'window', params: { ...ROUND_WINDOW, Height: 0.5 } })).toThrow(/round head/);
    expect(m.text()).toBe(before);
  });

  it('keeps the head round through a resize, and drops or adds it on request', async () => {
    const m = await model();
    const window = addHostedElementInStore(m.store, m.editor, m.wall, { kind: 'window', params: ROUND_WINDOW });
    editHostedElementInStore(m.store, m.editor, window.expressId, { OverallWidth: 1 });
    expect(readOpeningHead(m.store, window.openingId, m.view)?.rise).toBeCloseTo(0.5, 9);
    const extent = placedBodyExtent(m.store, window.openingId, m.view);
    expect((extent?.max[0] ?? 0) - (extent?.min[0] ?? 0)).toBeCloseTo(1, 9);
    expect(extent?.max[2]).toBeCloseTo(2.9, 9);
    editHostedElementInStore(m.store, m.editor, window.expressId, { Head: null });
    expect(readOpeningHead(m.store, window.openingId, m.view)).toBeNull();
    editHostedElementInStore(m.store, m.editor, window.expressId, { Head: { Shape: 'segmental', Rise: 0.3 } });
    expect(readOpeningHead(m.store, window.openingId, m.view)?.rise).toBeCloseTo(0.3, 9);
    expect(readHostedFill(m.store, window.expressId, m.view)?.offset).toBeCloseTo(2, 9);
  });

  it('writes a parseable IFC2X3 arched opening as a polyline', async () => {
    const m = await model('IFC2X3');
    addHostedElementInStore(m.store, m.editor, m.wall, { kind: 'window', params: ROUND_WINDOW });
    expect(m.text()).not.toContain('IFCINDEXEDPOLYCURVE');
    const reparsed = await new IfcParser().parseColumnar(new TextEncoder().encode(m.text()).buffer, { disableWorkerScan: true });
    expect(reparsed.entityIndex.byType.get('IFCWINDOW')).toHaveLength(1);
  });
});

describe.skipIf(!stairWasmAvailable)('arched openings through the wasm geometry pipeline', () => {
  it('voids the wall by the arched outline and fills it with a window reaching the crown', async () => {
    const m = await model();
    const window = addHostedElementInStore(m.store, m.editor, m.wall, { kind: 'window', params: ROUND_WINDOW });
    const meshes = await meshStairs(m.text());
    const wallVolume = volume(meshes.get(m.wall) ?? []);
    const arched = (1.2 * 1.4 + Math.PI * 0.36 / 2) * 0.24;
    expect(wallVolume).toBeCloseTo(8 * 3 * 0.24 - arched, 2);
    const { min, max } = stairMeshBounds(meshes.get(window.expressId) ?? []);
    expect(min[2]).toBeCloseTo(0.9, 3);
    expect(max[2]).toBeCloseTo(2.9, 3);
    expect(max[0] - min[0]).toBeCloseTo(1.2, 3);
  });

  it('frames an arched door whose leaf stays under the head', async () => {
    const m = await model();
    const door = addHostedElementInStore(m.store, m.editor, m.wall, { kind: 'door', params: { Offset: 5, Width: 1.1, Height: 2.3, Head: { Shape: 'round' } } });
    const meshes = await meshStairs(m.text());
    const { max } = stairMeshBounds(meshes.get(door.expressId) ?? []);
    expect(max[2]).toBeCloseTo(2.3, 3);
  });
});
