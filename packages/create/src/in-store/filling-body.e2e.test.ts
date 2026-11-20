/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Detailed doors and windows through the real wasm pipeline: every part
 * meshes as its own sub-mesh in its own colour, inside the opening, and the
 * GLB keeps one node per element with one child per part. Skips when
 * `packages/wasm/pkg/ifc-lite_bg.wasm` is not built on this host.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { IfcParser } from '@ifc-lite/parser';
import { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import { StepExporter } from '@ifc-lite/export';
import { IfcAPI, initSync } from '@ifc-lite/wasm';
import { IfcCreator } from '../ifc-creator.js';
import { resolveSpatialAnchor } from './resolve-anchor.js';
import { addWallToStore } from './wall.js';
import { addHostedElementInStore } from './hosted-element.js';
import { editHostedElementInStore } from './hosted-element-edit.js';

const WASM_PATH = fileURLToPath(new URL('../../../wasm/pkg/ifc-lite_bg.wasm', import.meta.url));
const WASM_AVAILABLE = existsSync(WASM_PATH);

type Vec3 = [number, number, number];
interface Part { color: number[]; min: Vec3; max: Vec3; triangles: number }

function parts(api: IfcAPI, content: string): Map<number, Part[]> {
  const bytes = new TextEncoder().encode(content);
  const pre = api.buildPrePassOnce(bytes);
  const out = new Map<number, Part[]>();
  try {
    const [x, y, z] = pre.rtcOffset ? Array.from(pre.rtcOffset as ArrayLike<number>) : [0, 0, 0];
    const collection = api.processGeometryBatch(bytes, pre.jobs, pre.unitScale, x, y, z, pre.needsShift,
      pre.voidKeys, pre.voidCounts, pre.voidValues, pre.styleIds, pre.styleColors);
    try {
      for (let i = 0; i < collection.length; i++) {
        const m = collection.get(i);
        if (!m) continue;
        try {
          const part: Part = { color: Array.from(m.color), min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], triangles: m.indices.length / 3 };
          for (let k = 0; k < m.positions.length; k += 3) {
            const ifc: Vec3 = [m.origin[0] + m.positions[k], -(m.origin[2] + m.positions[k + 2]), m.origin[1] + m.positions[k + 1]];
            for (let a = 0; a < 3; a++) { part.min[a] = Math.min(part.min[a], ifc[a]); part.max[a] = Math.max(part.max[a], ifc[a]); }
          }
          out.set(m.expressId, [...(out.get(m.expressId) ?? []), part]);
        } finally { m.free(); }
      }
    } finally { collection.free(); }
  } finally { api.clearPrePassCache(); }
  return out;
}

function glbJson(glb: Uint8Array): { nodes: Array<{ name?: string; children?: number[]; mesh?: number }>; scenes: Array<{ nodes: number[] }>; meshes: Array<{ primitives: Array<{ material?: number }> }> } {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  return JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + view.getUint32(12, true))));
}

async function model() {
  const creator = new IfcCreator({ Schema: 'IFC4' });
  const storey = creator.addIfcBuildingStorey({ Name: 'GF', Elevation: 0 });
  const store = await new IfcParser().parseColumnar(new TextEncoder().encode(creator.toIfc().content).buffer, { disableWorkerScan: true });
  const view = new MutablePropertyView(null, 'm'), editor = new StoreEditor(store, view);
  const wall = addWallToStore(editor, resolveSpatialAnchor(store, storey, view), { Start: [0, 0, 0], End: [8, 0, 0], Height: 3, Thickness: 0.24 }).wallId;
  const window = addHostedElementInStore(store, editor, wall, { kind: 'window', params: { Offset: 2, Sill: 0.9, Width: 1.2, Height: 1.4, PartitioningType: 'DOUBLE_PANEL_VERTICAL' } }).expressId;
  const door = addHostedElementInStore(store, editor, wall, { kind: 'door', params: { Offset: 5, Width: 1.6, Height: 2.1, OperationType: 'DOUBLE_DOOR_SINGLE_SWING' } }).expressId;
  const text = () => new TextDecoder().decode(new StepExporter(store, view).export({ schema: 'IFC4', applyMutations: true }).content);
  return { store, editor, window, door, text };
}

describe.skipIf(!WASM_AVAILABLE)('detailed fillings through the wasm geometry pipeline', () => {
  let api: IfcAPI;
  beforeAll(() => {
    initSync({ module: readFileSync(WASM_PATH) });
    api = new IfcAPI();
  });

  it('meshes every part with its own colour inside the opening', async () => {
    const m = await model();
    const meshed = parts(api, m.text());
    const window = meshed.get(m.window)!;
    expect(window).toHaveLength(4);
    const glass = window.filter(p => p.color[3] < 0.5);
    expect(glass).toHaveLength(2);
    expect(glass[0].color[3]).toBeCloseTo(0.28, 2);
    for (const p of window) {
      expect(p.triangles).toBeGreaterThan(0);
      expect(p.min[0]).toBeGreaterThanOrEqual(1.4 - 1e-6);
      expect(p.max[0]).toBeLessThanOrEqual(2.6 + 1e-6);
      expect(p.min[2]).toBeGreaterThanOrEqual(0.9 - 1e-6);
      expect(p.max[2]).toBeLessThanOrEqual(2.3 + 1e-6);
    }
    const lining = window.find(p => p.color[3] === 1)!;
    expect(lining.triangles).toBeGreaterThanOrEqual(16);

    const door = meshed.get(m.door)!;
    expect(door).toHaveLength(5);
    expect(new Set(door.map(p => p.color.map(c => c.toFixed(3)).join())).size).toBe(3);
  });

  it('keeps one GLB node per element with a child per part', async () => {
    const m = await model();
    const json = glbJson(api.exportGlbNamedByGlobalId(new TextEncoder().encode(m.text()), true, new Uint32Array(), undefined, 'IfcOpeningElement'));
    const roots = json.scenes[0].nodes.map(i => json.nodes[i]);
    const childCounts = roots.map(n => n.children?.length ?? 0).sort((a, b) => a - b);
    expect(childCounts).toEqual([1, 4, 5]);
    const materials = (node: { children?: number[] }) => new Set((node.children ?? []).flatMap(c => json.meshes[json.nodes[c].mesh!].primitives.map(p => p.material)));
    expect(roots.map(materials).map(s => s.size).sort()).toEqual([1, 2, 3]);
  });

  it('resizes every part with the opening', async () => {
    const m = await model();
    editHostedElementInStore(m.store, m.editor, m.window, { OverallWidth: 1.8 });
    const window = parts(api, m.text()).get(m.window)!;
    expect(window).toHaveLength(4);
    const min = Math.min(...window.map(p => p.min[0])), max = Math.max(...window.map(p => p.max[0]));
    expect(min).toBeCloseTo(1.1, 5);
    expect(max).toBeCloseTo(2.9, 5);
  });
});
