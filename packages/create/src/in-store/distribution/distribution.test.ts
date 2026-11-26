/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { MutablePropertyView, StoreEditor, type MutationEntityRef, type MutationStoreShape } from '@ifc-lite/mutations';
import type { SpatialAnchor, SpatialAnchorSchema } from '../anchor.js';
import { addDistributionElementToStore, addFlowPathElementToStore, addSolidElementToStore, emitRectangularSweep } from './element.js';
import { connectPortsInStore } from './ports.js';
import { addDistributionSystemToStore, assignToGroupInStore, assignToProductInStore } from './system.js';

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
      SystemType: 'DOMESTICCOLDWATER', FlowDirections: ['SINK', 'SOURCE'], PortNames: ['In', 'Out'],
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
    expect([start.attributes[2], end.attributes[2]]).toEqual(['In', 'Out']);
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

describe('rectangular flow path elements', () => {
  it('extrudes a rectangle along each path segment with the width kept horizontal', () => {
    const { editor, anchor, entity, ref } = setup('IFC4X3', 0.001);
    const r = addFlowPathElementToStore(editor, anchor, {
      Type: 'IfcDuctSegment', PredefinedType: 'RIGIDSEGMENT', Path: [[0, 0, 0], [2, 0, 0], [2, 0, 1]], Section: { Width: 0.2, Height: 0.05 },
      PortType: 'DUCT', SystemType: 'VENTILATION', FlowDirections: ['SINK', 'SOURCE'],
    });
    const rep = entity(r.shapeRepId);
    expect(rep.attributes[2]).toBe('SweptSolid');
    const [flat, riser] = listOf(rep.attributes[3]).map(ref);
    expect(flat.type).toBe('IfcExtrudedAreaSolid');
    expect(flat.attributes[3]).toBe(2000);
    const profile = ref(flat.attributes[0]);
    expect(profile.type).toBe('IfcRectangleProfileDef');
    expect(profile.attributes.slice(3)).toEqual([200, 50]);
    const flatAxes = ref(flat.attributes[1]);
    expect(ref(flatAxes.attributes[1]).attributes[0]).toEqual([1, 0, 0]);
    expect(ref(flatAxes.attributes[2]).attributes[0]).toEqual([0, 1, 0]);
    const riserAxes = ref(riser.attributes[1]);
    expect(ref(riserAxes.attributes[0]).attributes[0]).toEqual([2000, 0, 0]);
    expect(ref(riserAxes.attributes[1]).attributes[0]).toEqual([0, 0, 1]);
    expect(ref(riserAxes.attributes[2]).attributes[0]).toEqual([1, 0, 0]);
    expect(entity(r.portIds[1] ?? -1).attributes.slice(7)).toEqual(['.SOURCE.', '.DUCT.', '.VENTILATION.']);
  });

  it('writes a hollow section and exports the sweep for other products', () => {
    const { editor, anchor, entity, ref } = setup();
    const r = addFlowPathElementToStore(editor, anchor, { Type: 'IfcDuctFitting', PredefinedType: 'BEND', Path: [[0, 0, 0], [0, 1, 0]], Section: { Width: 0.2, Height: 0.1, WallThickness: 0.001 }, Ports: false });
    const solid = ref(listOf(entity(r.shapeRepId).attributes[3])[0]);
    expect(ref(solid.attributes[0]).type).toBe('IfcRectangleHollowProfileDef');
    const ids = emitRectangularSweep(editor, anchor, [[0, 0, 0], [1, 0, 0], [1, 1, 0]], { Width: 0.3, Height: 0.1 });
    expect(ids.map((id) => entity(id).type)).toEqual(['IfcExtrudedAreaSolid', 'IfcExtrudedAreaSolid']);
  });

  it('refuses both or neither of a diameter and a section, and a wall that leaves no bore', () => {
    const { editor, anchor } = setup();
    expect(() => addFlowPathElementToStore(editor, anchor, { Type: 'IfcDuctSegment', Path: [[0, 0, 0], [1, 0, 0]] })).toThrow(/OuterDiameter or Section/);
    expect(() => addFlowPathElementToStore(editor, anchor, { Type: 'IfcDuctSegment', Path: [[0, 0, 0], [1, 0, 0]], OuterDiameter: 0.1, Section: { Width: 0.1, Height: 0.1 } })).toThrow(/OuterDiameter or Section/);
    expect(() => addFlowPathElementToStore(editor, anchor, { Type: 'IfcDuctSegment', Path: [[0, 0, 0], [1, 0, 0]], Section: { Width: 0.1, Height: 0.04, WallThickness: 0.02 } })).toThrow(/WallThickness/);
    expect(() => addFlowPathElementToStore(editor, anchor, { Type: 'IfcDuctSegment', Path: [[0, 0, 0], [1, 0, 0]], Section: { Width: 0, Height: 0.04 } })).toThrow(/Width and Height/);
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
    const [wrapped, post] = listOf(rep.attributes[3]).map(ref);
    expect(wrapped.type).toBe('IfcCsgSolid');
    const cut = ref(wrapped.attributes[0]);
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

describe('addSolidElementToStore', () => {
  it('writes a built element or furniture from solids, with ports when given', () => {
    const { editor, anchor, entity } = setup();
    const chimney = addSolidElementToStore(editor, anchor, {
      Type: 'IfcChimney', PredefinedType: 'NOTDEFINED', Name: 'Chimney', Position: [1, 1, 0],
      Solids: [{ Outline: [[0, 0], [0.4, 0], [0.4, 0.4], [0, 0.4]], Position: [0, 0, 0], Depth: 9, Voids: [{ Radius: 0.08, Position: [0.2, 0.2, -0.1], Depth: 9.2 }] }],
      Ports: [{ Location: [0.2, 0, 1.5], Direction: [0, -1, 0], FlowDirection: 'SINK', PredefinedType: 'DUCT', SystemType: 'EXHAUST' }],
    });
    expect(entity(chimney.elementId).type).toBe('IfcChimney');
    expect(entity(chimney.elementId).attributes[8]).toBe('.NOTDEFINED.');
    expect(entity(chimney.shapeRepId).attributes[2]).toBe('CSG');
    expect(entity(chimney.portIds[0] ?? -1).attributes.slice(7)).toEqual(['.SINK.', '.DUCT.', '.EXHAUST.']);
    const worktop = addSolidElementToStore(editor, anchor, { Type: 'IfcSystemFurnitureElement', PredefinedType: 'WORKSURFACE', Position: [0, 0, 0.86], Solids: [{ Outline: [[0, 0], [2, 0], [2, 0.6], [0, 0.6]], Position: [0, 0, 0], Depth: 0.04 }] });
    expect(entity(worktop.elementId).type).toBe('IfcSystemFurnitureElement');
    expect(worktop.portIds).toEqual([]);
    expect(worktop.nestsRelId).toBeNull();
  });

  it('refuses what is not an element', () => {
    const { editor, anchor } = setup();
    expect(() => addSolidElementToStore(editor, anchor, { Type: 'IfcBuildingStorey', Position: [0, 0, 0], Solids: [{ Radius: 1, Position: [0, 0, 0], Depth: 1 }] })).toThrow(/IfcElement/);
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

  it('writes a circuit aggregated into its system and assigned to the port that feeds it', () => {
    const { editor, anchor, entity } = setup();
    const board = addDistributionElementToStore(editor, anchor, {
      Type: 'IfcElectricDistributionBoard', PredefinedType: 'DISTRIBUTIONBOARD', Position: [0, 0, 1], Solids: [{ Outline: [[0, 0], [0.5, 0], [0.5, 0.1], [0, 0.1]], Position: [0, 0, 0], Depth: 0.8 }],
      Ports: [{ Location: [0.25, 0.05, 0.8], Direction: [0, 0, 1], FlowDirection: 'SOURCE', PredefinedType: 'CABLE', SystemType: 'ELECTRICAL' }],
    });
    const system = addDistributionSystemToStore(editor, anchor, { Name: 'Electrical', PredefinedType: 'ELECTRICAL', ServicedBuildings: [40] });
    const circuit = addDistributionSystemToStore(editor, anchor, { Type: 'IfcDistributionCircuit', Name: 'F1', LongName: 'Sockets', PredefinedType: 'ELECTRICAL', PartOf: system.systemId });
    expect(entity(circuit.systemId).type).toBe('IfcDistributionCircuit');
    expect(entity(circuit.systemId).attributes.slice(2)).toEqual(['F1', null, null, 'Sockets', '.ELECTRICAL.']);
    expect(circuit.servicesRelId).toBeNull();
    const aggregates = entity(circuit.aggregatesRelId ?? -1);
    expect(aggregates.type).toBe('IfcRelAggregates');
    expect(aggregates.attributes.slice(4)).toEqual([`#${system.systemId}`, [`#${circuit.systemId}`]]);
    expect(system.aggregatesRelId).toBeNull();
    const fed = assignToProductInStore(editor, anchor, { ProductId: board.portIds[0] ?? -1, ObjectIds: [circuit.systemId] });
    expect(entity(fed).type).toBe('IfcRelAssignsToProduct');
    expect(entity(fed).attributes.slice(4)).toEqual([[`#${circuit.systemId}`], null, `#${board.portIds[0]}`]);
    expect(() => addDistributionSystemToStore(editor, anchor, { Type: 'IfcWall', Name: 'x' })).toThrow(/not an IfcDistributionSystem/);
    expect(() => assignToProductInStore(editor, anchor, { ProductId: 7, ObjectIds: [] })).toThrow(/at least one/);
  });
});
