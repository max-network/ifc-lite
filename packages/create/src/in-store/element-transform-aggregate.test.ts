/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { expect, it } from 'vitest';
import { IfcParser } from '@ifc-lite/parser';
import { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import { IfcCreator } from '../ifc-creator.js';
import { addStairToStore } from './stair.js';
import { resolveSpatialAnchor } from './resolve-anchor.js';
import { transformElementsInStore } from './element-transform-edit.js';
import { readElementTransformPlacement } from './element-transform-plan.js';
import { copyProductInStore, createCopyContext } from './copy-product.js';

async function stairModel() {
  const c = new IfcCreator({ Schema: 'IFC4', LengthUnit: 'METRE' });
  const storeyId = c.addIfcBuildingStorey({ Name: 'UG', Elevation: 0 });
  const store = await new IfcParser().parseColumnar(new TextEncoder().encode(c.toIfc().content).buffer as ArrayBuffer, { disableWorkerScan: true });
  const view = new MutablePropertyView(null, 'm'), editor = new StoreEditor(store, view);
  const built = addStairToStore(editor, resolveSpatialAnchor(store, storeyId, view), {
    Position: [12.9, 1, 0], Direction: Math.PI / 2, NumberOfRisers: 15, RiserHeight: 0.175, TreadLength: 0.25, Width: 1.1,
  });
  const origin = (id: number) => {
    const placed = readElementTransformPlacement({ dataStore: store, view: editor.getMutationView() }, id, storeyId);
    if ('reason' in placed) throw new Error(placed.reason);
    return placed.origin;
  };
  return { store, view, editor, built, storeyId, origin };
}

it('moves a stair with the flight it aggregates, whose placement hangs from the stair', async () => {
  const { store, editor, built, origin } = await stairModel();
  const result = transformElementsInStore({ dataStore: store, view: editor.getMutationView(), editor, selected: [built.stairId], op: { kind: 'move', delta: [0.55, 0] } });
  expect(origin(built.stairId)[0]).toBeCloseTo(13.45, 9);
  expect(origin(built.stairId)[1]).toBeCloseTo(1, 9);
  expect(result.remesh).toEqual(expect.arrayContaining([built.stairId, built.flightId]));
});

it('turns a stair with its flight', async () => {
  const { store, editor, built, origin } = await stairModel();
  transformElementsInStore({ dataStore: store, view: editor.getMutationView(), editor, selected: [built.stairId], op: { kind: 'rotate', pivot: [12.9, 1], angle: Math.PI / 2 } });
  expect(origin(built.stairId)[0]).toBeCloseTo(12.9, 9);
  expect(origin(built.stairId)[1]).toBeCloseTo(1, 9);
});

it('moves a copied stair on its own, leaving the original in place', async () => {
  const { store, editor, built, origin } = await stairModel();
  const copy = copyProductInStore(createCopyContext(store, editor), built.stairId, { offset: [0, 5, 0] });
  transformElementsInStore({ dataStore: store, view: editor.getMutationView(), editor, selected: [copy.copyId], op: { kind: 'move', delta: [0.55, 0] } });
  expect(origin(copy.copyId)[0]).toBeCloseTo(13.45, 9);
  expect(origin(copy.copyId)[1]).toBeCloseTo(6, 9);
  expect(origin(built.stairId)[0]).toBeCloseTo(12.9, 9);
});
