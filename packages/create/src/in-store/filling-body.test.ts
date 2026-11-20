/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { IfcParser } from '@ifc-lite/parser';
import { StepExporter } from '@ifc-lite/export';
import { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import { IfcCreator } from '../ifc-creator.js';
import { AnchorEntityReader, resolveSpatialAnchor } from './resolve-anchor.js';
import { addWallToStore } from './wall.js';
import { addHostedElementInStore } from './hosted-element.js';
import { addHostedDoorToStore, addHostedWindowToStore } from './hosted-fill.js';
import { resolveHostAnchor } from './resolve-host.js';
import { editHostedElementInStore, readHostedElementSize } from './hosted-element-edit.js';
import { readHostedFill } from './hosted-fill-read.js';
import { localBodyExtent } from './resolve-host.js';
import { retireProductShape } from './product-shape-retire.js';
import { refId } from './host-geometry-frame.js';
import { doorLayout, windowLayout, type FillingRect } from './filling-layout.js';

const size = (r: FillingRect) => [+(r.x1 - r.x0).toFixed(9), +(r.z1 - r.z0).toFixed(9)];

async function session(unit: 'METRE' | 'MILLIMETRE' = 'METRE') {
  const creator = new IfcCreator({ Schema: 'IFC4', LengthUnit: unit });
  const storey = creator.addIfcBuildingStorey({ Name: 'GF', Elevation: 0 });
  const store = await new IfcParser().parseColumnar(new TextEncoder().encode(creator.toIfc().content).buffer, { disableWorkerScan: true });
  const view = new MutablePropertyView(null, 'm'), editor = new StoreEditor(store, view);
  const anchor = resolveSpatialAnchor(store, storey, view);
  const wall = addWallToStore(editor, anchor, { Start: [0, 0, 0], End: [8, 0, 0], Height: 3, Thickness: 0.24 }).wallId;
  const reader = new AnchorEntityReader(store, view);
  const exported = () => new TextDecoder().decode(new StepExporter(store, view).export({ schema: 'IFC4', applyMutations: true }).content);
  return { store, view, editor, wall, reader, exported };
}

describe('window and door part layout', () => {
  it('splits a window per IfcWindowTypePartitioningEnum inside its lining', () => {
    const single = windowLayout('SINGLE_PANEL', 1.2, 1.4);
    expect(single.bars).toEqual([]);
    expect(single.panes.map(size)).toEqual([[1.1, 1.3]]);

    const double = windowLayout('DOUBLE_PANEL_VERTICAL', 1.2, 1.4);
    expect(double.bars.map(size)).toEqual([[0.05, 1.3]]);
    expect(double.panes.map(size)).toEqual([[0.525, 1.3], [0.525, 1.3]]);
    expect(double.bars[0].x0).toBeCloseTo(-0.025, 9);

    const transom = windowLayout('DOUBLE_PANEL_HORIZONTAL', 1.2, 1.4);
    expect(transom.panes.map(size)).toEqual([[1.1, 0.625], [1.1, 0.625]]);

    expect(windowLayout('TRIPLE_PANEL_VERTICAL', 1.8, 1.4).panes).toHaveLength(3);
    const bottom = windowLayout('TRIPLE_PANEL_BOTTOM', 1.2, 1.4);
    expect(bottom.bars).toHaveLength(2);
    expect(bottom.panes.map(size)).toEqual([[1.1, 0.625], [0.525, 0.625], [0.525, 0.625]]);
    expect(bottom.panes[0].z0).toBeCloseTo(0.05, 9);
    const left = windowLayout('TRIPLE_PANEL_LEFT', 1.2, 1.4);
    expect([left.panes[0].x0, left.panes[0].z0]).toEqual([expect.closeTo(-0.55, 9), expect.closeTo(0.05, 9)]);
    expect(size(left.panes[0])).toEqual([0.525, 1.3]);
  });

  it('caps the lining on small windows and never yields a negative pane', () => {
    const small = windowLayout('TRIPLE_PANEL_VERTICAL', 0.12, 0.3, 0.05);
    expect(small.lining).toBeCloseTo(0.03, 9);
    for (const pane of small.panes) expect(pane.x1 - pane.x0).toBeGreaterThan(0);
  });

  it('hinges and handles a door per IfcDoorTypeOperationEnum', () => {
    const left = doorLayout('SINGLE_SWING_LEFT', 0.9, 2.1);
    expect(left.leaves).toHaveLength(1);
    expect(left.handles).toHaveLength(1);
    expect(left.handles[0].x1).toBeGreaterThan(0.3);
    expect(left.handles[0].z0).toBeCloseTo(1.039, 9);
    expect(doorLayout('SINGLE_SWING_RIGHT', 0.9, 2.1).handles[0].x0).toBeLessThan(-0.3);

    const double = doorLayout('DOUBLE_DOOR_SINGLE_SWING', 1.6, 2.1);
    expect(double.leaves).toHaveLength(2);
    expect(double.leaves[0].x1).toBeLessThan(0);
    expect(double.leaves[1].x0).toBeGreaterThan(0);
    expect(double.handles.map(h => Math.sign(h.x0 + h.x1))).toEqual([-1, 1]);
    expect(doorLayout('REVOLVING', 1.6, 2.1).handles).toEqual([]);
    expect(doorLayout(undefined, 0.9, 2.1, 0.05, false).handles).toEqual([]);
    expect(left.frame).toHaveLength(8);
  });
});

describe('detailed door and window bodies', () => {
  it('writes a window as styled lining, mullion and glazing items with the box outline', async () => {
    const s = await session();
    const host = resolveHostAnchor(s.store, s.wall, s.view);
    const built = addHostedWindowToStore(s.editor, host, { Offset: 2, Sill: 0.9, Width: 1.2, Height: 1.4, PartitioningType: 'DOUBLE_PANEL_VERTICAL' });
    expect(built.parts.map(p => p.role)).toEqual(['lining', 'mullion', 'glazing', 'glazing']);
    const rep = s.reader.entity(built.shapeRepId)!;
    expect(rep.attributes[2]).toBe('SweptSolid');
    expect((rep.attributes[3] as unknown[]).map(refId)).toEqual(built.parts.map(p => p.solidId));
    expect(s.reader.entity(built.profileId)!.type).toBe('IfcRectangleHollowProfileDef');

    const styleName = (styledItemId: number) => {
      const styled = s.reader.entity(styledItemId)!;
      const surfaceId = refId((styled.attributes[1] as unknown[])[0])!;
      return { item: refId(styled.attributes[0]), name: s.reader.entity(surfaceId)!.attributes[0], surface: surfaceId };
    };
    const styles = built.parts.map(p => ({ part: p, ...styleName(p.styledItemId) }));
    for (const { part, item } of styles) expect(item).toBe(part.solidId);
    expect(styles.map(st => st.name)).toEqual(['Window lining', 'Window lining', 'Window glazing', 'Window glazing']);
    expect(new Set(styles.map(st => st.surface)).size).toBe(2);
    expect(s.exported()).toMatch(/IFCSURFACESTYLESHADING\(#\d+,0\.72\)/);

    const extent = localBodyExtent(s.store, built.fillingId, s.view)!;
    expect(extent.min).toEqual([-0.6, -0.025, 0].map(v => expect.closeTo(v, 9)));
    expect(extent.max).toEqual([0.6, 0.025, 1.4].map(v => expect.closeTo(v, 9)));
  });

  it('writes a door as lining, leaf and handle in the native length unit', async () => {
    const s = await session('MILLIMETRE');
    const host = resolveHostAnchor(s.store, s.wall, s.view);
    const built = addHostedDoorToStore(s.editor, host, { Offset: 2, Width: 0.9, Height: 2.1, FrameThickness: 0.08, PartColors: { leaf: '#804020' } });
    expect(built.parts.map(p => p.role)).toEqual(['lining', 'leaf', 'handle']);
    const extent = localBodyExtent(s.store, built.fillingId, s.view)!;
    expect(extent.min[0]).toBeCloseTo(-450, 6);
    expect(extent.max[2]).toBeCloseTo(2100, 6);
    const leaf = s.reader.entity(built.parts[1].solidId)!;
    expect(leaf.attributes[3]).toBeCloseTo(40, 9);
    expect(s.exported()).toMatch(/IFCSURFACESTYLE\('Door leaf'/);
    expect(s.exported()).toMatch(/IFCCOLOURRGB\(\$,0\.50196\d*,0\.25098\d*,0\.12549\d*\)/);
  });

  it("keeps the single box with Detail: 'box'", async () => {
    const s = await session();
    const host = resolveHostAnchor(s.store, s.wall, s.view);
    const built = addHostedDoorToStore(s.editor, host, { Offset: 2, Width: 0.9, Height: 2.1, Detail: 'box' });
    expect(built.parts).toEqual([]);
    expect((s.reader.entity(built.shapeRepId)!.attributes[3] as unknown[])).toHaveLength(1);
    expect(s.exported()).not.toMatch(/IFCSTYLEDITEM/);
  });

  it('resizes all parts together and keeps opening and filling relationships', async () => {
    const s = await session();
    const placed = addHostedElementInStore(s.store, s.editor, s.wall, {
      kind: 'window', params: { Offset: 3, Sill: 0.9, Width: 1.2, Height: 1.4, PartitioningType: 'TRIPLE_PANEL_TOP' },
    });
    const before = readHostedFill(s.store, placed.expressId, s.view)!;
    editHostedElementInStore(s.store, s.editor, placed.expressId, { OverallWidth: 1.8, OverallHeight: 1.2 });
    const after = readHostedFill(s.store, placed.expressId, s.view)!;
    expect([after.openingId, after.fillingId, after.hostId]).toEqual([before.openingId, before.fillingId, before.hostId]);
    expect(readHostedElementSize(s.store, placed.expressId, s.view)).toEqual({ OverallWidth: expect.closeTo(1.8, 9), OverallHeight: expect.closeTo(1.2, 9) });
    const extent = localBodyExtent(s.store, placed.expressId, s.view)!;
    expect(extent.max[0] - extent.min[0]).toBeCloseTo(1.8, 9);
    expect(extent.max[2] - extent.min[2]).toBeCloseTo(1.2, 9);
    const step = s.exported();
    expect(step.match(/IFCSTYLEDITEM\(/g)).toHaveLength(6);
    expect(step).toMatch(/IFCCARTESIANTRANSFORMATIONOPERATOR3DNONUNIFORM/);
  });

  it('retires the styled parts and their unshared styles with the product shape', async () => {
    const s = await session();
    const host = resolveHostAnchor(s.store, s.wall, s.view);
    const built = addHostedWindowToStore(s.editor, host, { Offset: 2, Sill: 0.9, Width: 1.2, Height: 1.4 });
    const kept = addHostedWindowToStore(s.editor, host, { Offset: 5, Sill: 0.9, Width: 1.2, Height: 1.4 });
    const surfaces = s.exported().match(/IFCSURFACESTYLE\(/g)!.length;
    s.editor.removeEntity(built.fillingId);
    const removed = retireProductShape(s.store, s.editor, built.productShapeId);
    for (const part of built.parts) expect(removed).toEqual(expect.arrayContaining([part.solidId, part.styledItemId]));
    const step = s.exported();
    expect(step.match(/IFCSTYLEDITEM\(/g)).toHaveLength(kept.parts.length);
    expect(step.match(/IFCSURFACESTYLE\(/g)).toHaveLength(surfaces - 2);
    expect(step).not.toMatch(new RegExp(`^#${built.parts[0].solidId}=`, 'm'));
  });
});
