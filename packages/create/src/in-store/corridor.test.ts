/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { MutablePropertyView, StoreEditor, type MutationEntityRef, type MutationStoreShape } from '@ifc-lite/mutations';
import type { CorridorDefinition } from '../corridor/corridor.js';
import { addCorridorInStore, CORRIDOR_PSET, readCorridorInStore } from './corridor.js';

const DEFINITION: CorridorDefinition = {
  Centreline: [[0, 0], [30, 0], [55, 25]],
  Radii: [15],
  Width: 3.5,
  CrossFall: 0.02,
  CrossFallSide: 'right',
  Profile: [{ Station: 0, Height: 1 }, { Station: 40, Grade: 0.04 }, { Station: 60, Grade: 0.08 }],
  MaxGrade: 0.12,
  MinK: 4,
  Kerb: { Height: 0.1, Width: 0.25 },
};

const ANCHOR = { ownerHistoryId: 5, bodyContextId: 14, axisContextId: 15, projectId: 1, siteId: 30, sitePlacementId: 31, lengthUnitScale: 0.001 };

function makeStore(maxId: number): MutationStoreShape {
  const byId = new Map<number, MutationEntityRef>();
  for (let id = 1; id <= maxId; id++) byId.set(id, { expressId: id, type: 'IFCDUMMY', byteOffset: 0, byteLength: 1, lineNumber: id });
  return { entityIndex: { byId } };
}

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const numbers = (value: unknown): number[][] => list(value).map((row) => list(row).map((v) => (typeof v === 'number' ? v : NaN)));

const real = (value: unknown): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'object' && value !== null && 'real' in value && typeof value.real === 'number') return value.real;
  throw new Error(`not a number: ${JSON.stringify(value)}`);
};

describe('addCorridorInStore', () => {
  const view = new MutablePropertyView(null, 'm1');
  const editor = new StoreEditor(makeStore(40), view);
  const result = addCorridorInStore(editor, ANCHOR, { Name: 'Driveway', ObjectType: 'driveway', PredefinedType: 'FLEXIBLE', Definition: DEFINITION });
  const entities = view.getNewEntities();
  const byId = new Map(entities.map((e) => [e.expressId, e]));
  const ofType = (type: string) => entities.filter((e) => e.type.toUpperCase() === type.toUpperCase());
  const ref = (value: unknown) => (typeof value === 'string' && value.startsWith('#') ? byId.get(Number(value.slice(1))) : undefined);

  it('writes an IfcPavement whose tessellated body is the corridor mesh in the file unit', () => {
    const pavement = byId.get(result.pavementId);
    expect(pavement?.type).toBe('IfcPavement');
    expect(pavement?.attributes.slice(2, 5)).toEqual(['Driveway', null, 'driveway']);
    expect(pavement?.attributes[8]).toBe('.FLEXIBLE.');
    const shape = ref(pavement?.attributes[6]);
    const representation = ref(list(shape?.attributes[2])[0]);
    expect(representation?.attributes.slice(0, 3)).toEqual(['#14', 'Body', 'Tessellation']);
    const faces = ref(list(representation?.attributes[3])[0]);
    expect(faces?.type).toBe('IfcTriangulatedFaceSet');
    expect(faces?.attributes[3]).toHaveLength(result.corridor.mesh.pavement.length);
    const points = list(ref(faces?.attributes[0])?.attributes[0]).map(list);
    const [x, y, z] = result.corridor.mesh.positions[result.corridor.mesh.pavement[0][0]];
    const first = numbers(faces?.attributes[3])[0][0];
    expect(points[first - 1].map(real)).toEqual([x * 1000, y * 1000, z * 1000].map((v) => expect.closeTo(v, 6)));
  });

  it('aggregates one IfcKerb per side into the pavement', () => {
    expect(result.kerbIds).toHaveLength(2);
    for (const id of result.kerbIds) expect(byId.get(id)?.type).toBe('IfcKerb');
    const aggregates = ofType('IfcRelAggregates').find((rel) => rel.attributes[4] === `#${result.pavementId}`);
    expect(aggregates?.attributes[5]).toEqual(result.kerbIds.map((id) => `#${id}`));
  });

  it('positions the pavement by an IfcAlignment with the parabolic vertical curve it was built from', () => {
    expect(byId.get(result.alignmentId)?.type.toUpperCase()).toBe('IFCALIGNMENT');
    const positions = ofType('IfcRelPositions').find((rel) => rel.attributes[4] === `#${result.alignmentId}`);
    expect(positions?.attributes[5]).toEqual([`#${result.pavementId}`, ...result.kerbIds.map((id) => `#${id}`)]);
    const parabola = ofType('IfcAlignmentVerticalSegment').find((s) => s.attributes[8] === '.PARABOLICARC.');
    const [curve] = result.corridor.curves;
    expect(parabola?.attributes.slice(2, 7).map(real)).toEqual([curve.start * 1000, curve.length * 1000, expect.any(Number), 0.04, 0.08].map((v) => (typeof v === 'number' ? expect.closeTo(v, 6) : v)));
    const arc = ofType('IfcAlignmentHorizontalSegment').find((s) => s.attributes[8] === '.CIRCULARARC.');
    expect(real(arc?.attributes[4])).toBeCloseTo(15000, 6);
  });

  it('hangs the alignment from the project and references it in the site that contains the pavement', () => {
    expect(ofType('IfcRelAggregates').some((rel) => rel.attributes[4] === '#1' && list(rel.attributes[5]).includes(`#${result.alignmentId}`))).toBe(true);
    expect(ofType('IfcRelReferencedInSpatialStructure').some((rel) => rel.attributes[5] === '#30' && list(rel.attributes[4]).includes(`#${result.alignmentId}`))).toBe(true);
    expect(ofType('IfcRelContainedInSpatialStructure').some((rel) => rel.attributes[5] === '#30' && list(rel.attributes[4]).includes(`#${result.pavementId}`))).toBe(true);
  });

  it('records the definition so it reads back exactly', () => {
    expect(view.getPropertyValue(result.pavementId, CORRIDOR_PSET, 'Definition')).toEqual(expect.any(String));
    expect(readCorridorInStore(view, result.pavementId)).toEqual(DEFINITION);
  });

  it('writes no kerbs for a corridor without them', () => {
    const plain = addCorridorInStore(new StoreEditor(makeStore(40), new MutablePropertyView(null, 'm2')), ANCHOR, { Name: 'Path', Definition: { ...DEFINITION, Kerb: undefined } });
    expect(plain.kerbIds).toEqual([]);
  });
});
