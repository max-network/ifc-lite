/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { MutablePropertyView, StoreEditor, type MutationEntityRef, type MutationStoreShape } from '@ifc-lite/mutations';
import type { SpatialAnchor, SpatialAnchorSchema } from '../anchor.js';
import { addDistributionElementToStore, addFlowPathElementToStore } from './element.js';
import { connectPortsInStore } from './ports.js';
import { addDistributionSystemToStore, assignToGroupInStore } from './system.js';

const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

function setup(schema: SpatialAnchorSchema = 'IFC4X3', lengthUnitScale?: number) {
  const byId = new Map<number, MutationEntityRef>();
  for (let id = 1; id <= 60; id++) byId.set(id, { expressId: id, type: 'IFCDUMMY', byteOffset: 0, byteLength: 1, lineNumber: id });
  const store: MutationStoreShape = { entityIndex: { byId } };
  const view = new MutablePropertyView(null, 'm1');
  const editor = new StoreEditor(store, view);
  const anchor: SpatialAnchor = { ownerHistoryId: 5, bodyContextId: 14, axisContextId: 15, storeyId: 43, storeyPlacementId: 54, schema, lengthUnitScale };
  const entity = (id: number) => {
    const found = view.getNewEntities().find((e) => e.expressId === id);
    if (!found) throw new Error(`no entity #${id}`);
    return found;
  };
  const ref = (value: unknown) => entity(Number(String(value).slice(1)));
  return { editor, anchor, entity, ref };
}

describe('addFlowPathElementToStore', () => {
  it('writes a pipe segment as a hollow swept disk with a port nested at each end', () => {
    const { editor, anchor, entity, ref } = setup();
    const r = addFlowPathElementToStore(editor, anchor, {
      Type: 'IfcPipeSegment', PredefinedType: 'RIGIDSEGMENT', Name: 'Pipe', Path: [[1, 2, 0.5], [4, 2, 0.5]], OuterDiameter: 0.022, InnerDiameter: 0.02,
      SystemType: 'DOMESTICCOLDWATER', FlowDirections: ['SINK', 'SOURCE'],
    });
    const pipe = entity(r.elementId);
    expect(pipe.type).toBe('IfcPipeSegment');
    expect(pipe.attributes[2]).toBe('Pipe');
    expect(pipe.attributes[8]).toBe('.RIGIDSEGMENT.');
    const solid = ref(listOf(entity(r.shapeRepId).attributes[3])[0]);
    expect(solid.type).toBe('IfcSweptDiskSolid');
    expect(solid.attributes[1]).toEqual({ real: 0.011 });
    expect(solid.attributes[2]).toEqual({ real: 0.01 });
    expect(entity(r.shapeRepId).attributes[2]).toBe('AdvancedSweptSolid');
    expect(r.portIds).toHaveLength(2);
    const [start, end] = r.portIds.map(entity);
    expect(start.type).toBe('IfcDistributionPort');
    expect(start.attributes.slice(7)).toEqual(['.SINK.', '.PIPE.', '.DOMESTICCOLDWATER.']);
    expect(end.attributes.slice(7)).toEqual(['.SOURCE.', '.PIPE.', '.DOMESTICCOLDWATER.']);
    const endPlacement = ref(end.attributes[5]);
    expect(endPlacement.attributes[0]).toBe(`#${r.placementId}`);
    const endAxis = ref(endPlacement.attributes[1]);
    expect(ref(endAxis.attributes[0]).attributes[0]).toEqual([3, 0, 0]);
    expect(ref(endAxis.attributes[1]).attributes[0]).toEqual([1, 0, 0]);
    const nests = entity(r.nestsRelId ?? -1);
    expect(nests.type).toBe('IfcRelNests');
    expect(nests.attributes.slice(4)).toEqual([`#${r.elementId}`, r.portIds.map((id) => `#${id}`)]);
    expect(entity(r.relContainedId).attributes.slice(4)).toEqual([[`#${r.elementId}`], '#43']);
  });

  it('writes native units in a millimetre model', () => {
    const { editor, anchor, entity, ref } = setup('IFC4X3', 0.001);
    const r = addFlowPathElementToStore(editor, anchor, { Type: 'IfcPipeFitting', PredefinedType: 'BEND', Path: [[0, 0, 0], [0.1, 0, 0], [0.1, 0.1, 0]], OuterDiameter: 0.05, Ports: false });
    expect(r.portIds).toEqual([]);
    expect(r.nestsRelId).toBeNull();
    const solid = ref(listOf(entity(r.shapeRepId).attributes[3])[0]);
    expect(solid.attributes[1]).toEqual({ real: 25 });
    expect(solid.attributes[2]).toBeNull();
  });

  it('refuses what is not a distribution element, a bad path or a bore wider than the pipe', () => {
    const { editor, anchor } = setup();
    expect(() => addFlowPathElementToStore(editor, anchor, { Type: 'IfcWall', Path: [[0, 0, 0], [1, 0, 0]], OuterDiameter: 0.02 })).toThrow(/IfcDistributionElement/);
    expect(() => addFlowPathElementToStore(editor, anchor, { Type: 'IfcPipeSegment', Path: [[0, 0, 0], [0, 0, 0]], OuterDiameter: 0.02 })).toThrow(/distinct/);
    expect(() => addFlowPathElementToStore(editor, anchor, { Type: 'IfcPipeSegment', Path: [[0, 0, 0], [1, 0, 0]], OuterDiameter: 0.02, InnerDiameter: 0.03 })).toThrow(/InnerDiameter/);
    expect(() => addFlowPathElementToStore(editor, anchor, { Type: 'IfcPipeSegment', PredefinedType: 'BEND', Path: [[0, 0, 0], [1, 0, 0]], OuterDiameter: 0.02 })).toThrow(/PredefinedType/);
    expect(() => addFlowPathElementToStore(setup('IFC2X3').editor, setup('IFC2X3').anchor, { Type: 'IfcPipeSegment', Path: [[0, 0, 0], [1, 0, 0]], OuterDiameter: 0.02 })).toThrow(/IFC4 or later/);
  });
});

describe('addDistributionElementToStore', () => {
  it('writes a terminal from extruded solids, a void as a boolean difference, and its ports', () => {
    const { editor, anchor, entity, ref } = setup();
    const r = addDistributionElementToStore(editor, anchor, {
      Type: 'IfcSanitaryTerminal', PredefinedType: 'WASHHANDBASIN', Name: 'Basin', Position: [2, 1, 0], RefDirection: [0, 1, 0],
      Solids: [
        { Outline: [[0, 0], [0.6, 0], [0.6, 0.45], [0, 0.45]], Position: [0, 0, 0.7], Depth: 0.15, Voids: [{ Radius: 0.18, Position: [0.3, 0.22, 0.75], Depth: 0.2 }] },
        { Radius: 0.03, Position: [0.3, 0.05, 0.4], Depth: 0.3 },
      ],
      Ports: [{ Location: [0.3, 0, 0.55], Direction: [0, -1, 0], FlowDirection: 'SOURCE', SystemType: 'SEWAGE' }],
    });
    const basin = entity(r.elementId);
    expect(basin.type).toBe('IfcSanitaryTerminal');
    expect(basin.attributes[8]).toBe('.WASHHANDBASIN.');
    const rep = entity(r.shapeRepId);
    expect(rep.attributes[2]).toBe('SolidModel');
    const [cut, post] = listOf(rep.attributes[3]).map(ref);
    expect(cut.type).toBe('IfcBooleanResult');
    expect(cut.attributes[0]).toBe('.DIFFERENCE.');
    expect(ref(cut.attributes[1]).type).toBe('IfcExtrudedAreaSolid');
    expect(ref(ref(cut.attributes[2]).attributes[0]).type).toBe('IfcCircleProfileDef');
    expect(post.type).toBe('IfcExtrudedAreaSolid');
    const axis = ref(ref(entity(r.placementId).attributes[1]).attributes[2]);
    expect(axis.attributes[0]).toEqual([0, 1, 0]);
    expect(entity(r.portIds[0] ?? -1).attributes.slice(7)).toEqual(['.SOURCE.', '.PIPE.', '.SEWAGE.']);
  });

  it('refuses a solid with both or neither of outline and radius', () => {
    const { editor, anchor } = setup();
    expect(() => addDistributionElementToStore(editor, anchor, { Type: 'IfcSpaceHeater', Position: [0, 0, 0], Solids: [{ Position: [0, 0, 0], Depth: 1 }] })).toThrow(/Outline or Radius/);
    expect(() => addDistributionElementToStore(editor, anchor, { Type: 'IfcSpaceHeater', Position: [0, 0, 0], Solids: [] })).toThrow(/at least one/);
  });
});

describe('distribution systems and connections', () => {
  it('writes a system serving a building, assigns elements and connects two ports', () => {
    const { editor, anchor, entity } = setup();
    const a = addFlowPathElementToStore(editor, anchor, { Type: 'IfcPipeSegment', Path: [[0, 0, 0], [1, 0, 0]], OuterDiameter: 0.02 });
    const b = addFlowPathElementToStore(editor, anchor, { Type: 'IfcPipeSegment', Path: [[1, 0, 0], [1, 1, 0]], OuterDiameter: 0.02 });
    const system = addDistributionSystemToStore(editor, anchor, { Name: 'Cold water', PredefinedType: 'DOMESTICCOLDWATER', ServicedBuildings: [40] });
    expect(entity(system.systemId).type).toBe('IfcDistributionSystem');
    expect(entity(system.systemId).attributes.slice(2)).toEqual(['Cold water', null, null, null, '.DOMESTICCOLDWATER.']);
    expect(entity(system.servicesRelId ?? -1).attributes.slice(4)).toEqual([`#${system.systemId}`, ['#40']]);
    const assigned = assignToGroupInStore(editor, anchor, { GroupId: system.systemId, ObjectIds: [a.elementId, b.elementId, a.elementId] });
    expect(entity(assigned).type).toBe('IfcRelAssignsToGroup');
    expect(entity(assigned).attributes.slice(4)).toEqual([[`#${a.elementId}`, `#${b.elementId}`], null, `#${system.systemId}`]);
    const link = connectPortsInStore(editor, anchor, { RelatingPort: a.portIds[1] ?? -1, RelatedPort: b.portIds[0] ?? -1 });
    expect(entity(link).type).toBe('IfcRelConnectsPorts');
    expect(entity(link).attributes.slice(4)).toEqual([`#${a.portIds[1]}`, `#${b.portIds[0]}`, null]);
    expect(() => connectPortsInStore(editor, anchor, { RelatingPort: 7, RelatedPort: 7 })).toThrow(/itself/);
    expect(() => assignToGroupInStore(editor, anchor, { GroupId: system.systemId, ObjectIds: [] })).toThrow(/at least one/);
  });
});
