/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { IfcParser } from '@ifc-lite/parser';
import { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import { StepExporter } from '@ifc-lite/export';
import { IfcCreator } from '../ifc-creator.js';
import { resolveSpatialAnchor } from './resolve-anchor.js';
import * as create from './index.js';

const SPIRAL = {
  Centre: [4, 3, 0] as [number, number, number],
  OuterRadius: 0.8,
  NewelRadius: 0.1,
  StartAngle: Math.PI / 2,
  NumberOfRisers: 13,
  RiserHeight: 2.5 / 13,
  TreadAngle: (26 * Math.PI) / 180,
  WalkingLineRadius: 0.8 * (2 / 3),
  TreadThickness: 0.06,
};

const parse = (text: string) => new IfcParser().parseColumnar(new TextEncoder().encode(text).buffer, { disableWorkerScan: true });

async function exported(schema: 'IFC2X3' | 'IFC4' | 'IFC4X3', millimetres: boolean, turn: 'ccw' | 'cw') {
  const c = new IfcCreator({ Schema: schema, LengthUnit: millimetres ? 'MILLIMETRE' : 'METRE' });
  const storey = c.addIfcBuildingStorey({ Name: 'GF', Elevation: 0 });
  const slab = c.addIfcSlab(storey, { Position: [0, 0, 2.25], Width: 8, Depth: 6, Thickness: 0.25 });
  const store = await parse(c.toIfc().content);
  const view = new MutablePropertyView(null, 'm');
  const editor = new StoreEditor(store, view);
  const built = editor.runAtomic(draft => create.addSpiralStairToStore(draft, resolveSpatialAnchor(store, storey, view), { ...SPIRAL, Turn: turn }));
  const hole = create.addHostedElementInStore(store, editor, slab, { kind: 'opening', params: { Position: [4, 3], Radius: 0.85 } });
  const text = new TextDecoder().decode(new StepExporter(store, view).export({ schema, applyMutations: true }).content);
  return { text, built, hole, reread: await parse(text) };
}

describe('spiral stairs', () => {
  for (const schema of ['IFC2X3', 'IFC4', 'IFC4X3'] as const) for (const millimetres of [false, true]) for (const turn of ['ccw', 'cw'] as const) {
    it(`${schema} ${millimetres ? 'mm' : 'm'} ${turn}: writes one flight of treads around a newel and reads it back`, async () => {
      const { text, built, reread } = await exported(schema, millimetres, turn);
      expect(text).toMatch(schema === 'IFC2X3' ? /IFCSTAIR\([^;]*\.SPIRAL_STAIR\.\);/ : /IFCSTAIR\([^;]*\.SPIRAL_STAIR\.\);/);
      if (schema !== 'IFC2X3') expect(text).toMatch(/IFCSTAIRFLIGHT\([^;]*\.SPIRAL\.\);/);
      expect(built.treadSolidIds).toHaveLength(SPIRAL.NumberOfRisers);
      const read = create.readSpiralStair(reread, built.stairId);
      expect(read).not.toBeNull();
      expect(read!.Turn).toBe(turn);
      expect(read!.NumberOfRisers).toBe(13);
      for (const [index, value] of read!.Centre.entries()) expect(value).toBeCloseTo(SPIRAL.Centre[index], 6);
      expect(read!.OuterRadius).toBeCloseTo(SPIRAL.OuterRadius, 4);
      expect(read!.NewelRadius).toBeCloseTo(SPIRAL.NewelRadius, 4);
      expect(read!.RiserHeight).toBeCloseTo(SPIRAL.RiserHeight, 6);
      expect(read!.TreadAngle).toBeCloseTo(SPIRAL.TreadAngle, 3);
      expect(read!.StartAngle).toBeCloseTo(SPIRAL.StartAngle, 3);
      expect(read!.WalkingLineRadius).toBeCloseTo(SPIRAL.WalkingLineRadius, 3);
      expect(read!.TreadThickness).toBeCloseTo(SPIRAL.TreadThickness, 6);
      expect(create.readStairDimensions(reread, built.stairId)).toBeNull();
    });
  }

  it('lays its nosing lines on the treads, the last one at the full rise', () => {
    const edges = create.spiralStairEdges({ ...SPIRAL, Turn: 'cw' });
    expect(edges.outer).toHaveLength(SPIRAL.NumberOfRisers + 1);
    const [first] = edges.outer;
    expect(first[0]).toBeCloseTo(4, 9);
    expect(first[1]).toBeCloseTo(3.8, 9);
    expect(first[2]).toBeCloseTo(SPIRAL.RiserHeight, 9);
    const second = edges.walkingLine[1];
    const angle = Math.atan2(second[1] - 3, second[0] - 4);
    expect(angle).toBeCloseTo(Math.PI / 2 - SPIRAL.TreadAngle, 9);
    expect(edges.inner.at(-1)![2]).toBeCloseTo(2.5, 9);
  });

  it('refuses a walking line outside the treads and a newel wider than the stair', () => {
    expect(() => create.spiralStairEdges({ ...SPIRAL })).not.toThrow();
    const c = new IfcCreator({ Schema: 'IFC4' });
    const storey = c.addIfcBuildingStorey({ Name: 'GF', Elevation: 0 });
    return parse(c.toIfc().content).then(store => {
      const view = new MutablePropertyView(null, 'm');
      const editor = new StoreEditor(store, view);
      const anchor = resolveSpatialAnchor(store, storey, view);
      expect(() => create.addSpiralStairToStore(editor, anchor, { ...SPIRAL, WalkingLineRadius: 0.9 })).toThrow(/WalkingLineRadius/);
      expect(() => create.addSpiralStairToStore(editor, anchor, { ...SPIRAL, NewelRadius: 0.8 })).toThrow(/NewelRadius/);
    });
  });
});

describe('round and outlined slab openings', () => {
  it('cuts a circle and a polygon into a slab whose bounds read back', async () => {
    const { text, hole, reread } = await exported('IFC4', false, 'ccw');
    expect(text).toMatch(/IFCRELVOIDSELEMENT\(/);
    const bounds = create.placedBodyExtent(reread, hole.openingId);
    expect(bounds).not.toBeNull();
    expect(bounds!.max[0] - bounds!.min[0]).toBeCloseTo(1.7, 6);
    expect(bounds!.max[1] - bounds!.min[1]).toBeCloseTo(1.7, 6);
    const c = new IfcCreator({ Schema: 'IFC4' });
    const storey = c.addIfcBuildingStorey({ Name: 'GF', Elevation: 0 });
    const slab = c.addIfcSlab(storey, { Position: [0, 0, 0], Width: 8, Depth: 6, Thickness: 0.25 });
    const store = await parse(c.toIfc().content);
    const view = new MutablePropertyView(null, 'm');
    const outlined = create.addHostedElementInStore(store, new StoreEditor(store, view), slab, {
      kind: 'opening', params: { Position: [1, 1], Outline: [[0, 0], [2, 0], [2, 1], [0, 1]] },
    });
    const box = create.placedBodyExtent(store, outlined.openingId, view);
    expect(box!.min[0]).toBeCloseTo(1, 9);
    expect(box!.max[0]).toBeCloseTo(3, 9);
    expect(box!.max[1]).toBeCloseTo(2, 9);
  });
});

describe('host openings after a delete in the same session', () => {
  it('leaves a deleted opening out of the host read instead of reporting it unreadable', async () => {
    const c = new IfcCreator({ Schema: 'IFC4' });
    const storey = c.addIfcBuildingStorey({ Name: 'GF', Elevation: 0 });
    const wall = c.addIfcWall(storey, { Start: [0, 0, 0], End: [6, 0, 0], Thickness: 0.3, Height: 2.8 });
    const store = await parse(c.toIfc().content);
    const view = new MutablePropertyView(null, 'm');
    const editor = new StoreEditor(store, view);
    const first = create.addHostedElementInStore(store, editor, wall, { kind: 'window', params: { Offset: 2, Sill: 0.9, Width: 1.2, Height: 1.2 } });
    editor.removeEntity(first.expressId);
    editor.removeEntity(first.openingId);
    expect(create.readHostOpeningExtents(store, wall, view)).toEqual({ cuts: [], unreadable: [] });
    expect(() => create.addHostedElementInStore(store, editor, wall, { kind: 'door', params: { Offset: 2, Width: 1.2, Height: 2.1 } })).not.toThrow();
  });
});
