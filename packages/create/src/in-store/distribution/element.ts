/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { StoreEditor } from '@ifc-lite/mutations';
import { assertFinitePoint3, completePlacementAxes } from '../../ifc-creator-math.js';
import { toNativeLength, toNativePoint2, toNativePoint3, type SpatialAnchor } from '../anchor.js';
import { assertPositiveFinite, emitLocalPlacement, emitPolygonProfile, emitRelContainedInSpatialStructure, ownerHistoryRef, productGuid } from '../_emit-helpers.js';
import { conformsTo, schemaEntityAttributes } from '../schema-attributes.js';
import { addDistributionPortsToStore, distributionRegistry, type DistributionPortParams, type PortFlowDirection, type Vec3 } from './ports.js';

export interface DistributionElementHeader {
  Type: string;
  PredefinedType?: string;
  Name?: string;
  Description?: string;
  ObjectType?: string;
  Tag?: string;
  GlobalId?: string;
}

export interface FlowPathElementInStoreParams extends DistributionElementHeader {
  Path: ReadonlyArray<readonly [number, number, number]>;
  OuterDiameter: number;
  InnerDiameter?: number;
  PortType?: string;
  SystemType?: string;
  FlowDirections?: readonly [PortFlowDirection, PortFlowDirection];
  PortNames?: readonly [string, string];
  Ports?: boolean;
}

export interface DistributionSolidParams {
  Outline?: ReadonlyArray<readonly [number, number]>;
  Radius?: number;
  Position: readonly [number, number, number];
  Axis?: readonly [number, number, number];
  RefDirection?: readonly [number, number, number];
  Depth: number;
  Voids?: readonly DistributionSolidParams[];
}

export interface SolidElementInStoreParams extends DistributionElementHeader {
  Position: readonly [number, number, number];
  Axis?: readonly [number, number, number];
  RefDirection?: readonly [number, number, number];
  Solids: readonly DistributionSolidParams[];
  Ports?: readonly DistributionPortParams[];
}

export type DistributionElementInStoreParams = SolidElementInStoreParams;

export interface DistributionElementBuildResult {
  elementId: number;
  placementId: number;
  shapeRepId: number;
  productShapeId: number;
  relContainedId: number;
  portIds: number[];
  nestsRelId: number | null;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vec = (p: readonly [number, number, number]): Vec3 => [p[0], p[1], p[2]];

function pathOf(params: FlowPathElementInStoreParams, op: string): Vec3[] {
  if (!Array.isArray(params.Path) || params.Path.length < 2) throw new Error(`${op}: Path needs at least two points`);
  const path = params.Path.map(vec);
  path.forEach((p, i) => assertFinitePoint3({ [`Path[${i}]`]: p }, op));
  for (let i = 1; i < path.length; i++) {
    if (Math.hypot(...sub(path[i], path[i - 1])) <= 1e-9) throw new Error(`${op}: Path[${i - 1}] and Path[${i}] must be distinct points`);
  }
  assertPositiveFinite([params.OuterDiameter], `${op}: OuterDiameter must be a finite positive number`);
  if (params.InnerDiameter !== undefined) {
    assertPositiveFinite([params.InnerDiameter], `${op}: InnerDiameter must be a finite positive number`);
    if (params.InnerDiameter >= params.OuterDiameter) throw new Error(`${op}: InnerDiameter must be less than OuterDiameter`);
  }
  return path;
}

function elementValues(params: DistributionElementHeader, anchor: SpatialAnchor, placement: string | null, shape: string | null): Record<string, unknown> {
  return {
    GlobalId: productGuid(params, anchor.guidRandom),
    OwnerHistory: ownerHistoryRef(anchor.ownerHistoryId),
    Name: params.Name ?? params.Type.replace(/^Ifc/, ''),
    Description: params.Description,
    ObjectType: params.ObjectType,
    ObjectPlacement: placement,
    Representation: shape,
    Tag: params.Tag,
    PredefinedType: params.PredefinedType,
  };
}

function checkedHeader(anchor: SpatialAnchor, params: DistributionElementHeader, op: string, supertype = 'IfcDistributionElement') {
  const registry = distributionRegistry(anchor, op);
  if (!conformsTo(registry, params.Type, supertype)) throw new Error(`${op}: ${params.Type} is not an ${supertype} in ${registry.name}`);
  const values = elementValues(params, anchor, null, null);
  schemaEntityAttributes(registry, params.Type, values, op);
  return { registry, globalId: values.GlobalId };
}

function emitBody(editor: StoreEditor, anchor: SpatialAnchor, representationType: string, items: readonly number[]) {
  const shapeRepId = editor.addEntity('IfcShapeRepresentation', [`#${anchor.bodyContextId}`, 'Body', representationType, items.map((id) => `#${id}`)]).expressId;
  const productShapeId = editor.addEntity('IfcProductDefinitionShape', [null, null, [`#${shapeRepId}`]]).expressId;
  return { shapeRepId, productShapeId };
}

function emitElement(
  editor: StoreEditor,
  anchor: SpatialAnchor,
  params: DistributionElementHeader,
  checked: ReturnType<typeof checkedHeader>,
  placementId: number,
  body: { shapeRepId: number; productShapeId: number },
  ports: readonly DistributionPortParams[],
  op: string,
): DistributionElementBuildResult {
  const values = { ...elementValues(params, anchor, `#${placementId}`, `#${body.productShapeId}`), GlobalId: checked.globalId };
  const elementId = editor.addEntity(params.Type, schemaEntityAttributes(checked.registry, params.Type, values, op)).expressId;
  const relContainedId = emitRelContainedInSpatialStructure(editor, anchor.ownerHistoryId, elementId, anchor.storeyId, anchor.guidRandom);
  const nested = addDistributionPortsToStore(editor, anchor, { ElementId: elementId, ElementPlacementId: placementId, Ports: ports });
  return { elementId, placementId, ...body, relContainedId, ...nested };
}

export function addFlowPathElementToStore(editor: StoreEditor, anchor: SpatialAnchor, params: FlowPathElementInStoreParams): DistributionElementBuildResult {
  const op = 'addFlowPathElementToStore';
  const path = pathOf(params, op);
  const checked = checkedHeader(anchor, params, op);
  const origin = path[0];
  const local = path.map((p) => sub(p, origin));
  const placementId = emitLocalPlacement(editor, anchor.storeyPlacementId, toNativePoint3(anchor, origin), [0, 0, 1], [1, 0, 0]);
  const points = local.map((p) => editor.addEntity('IfcCartesianPoint', [toNativePoint3(anchor, p)]).expressId);
  const directrix = editor.addEntity('IfcPolyline', [points.map((id) => `#${id}`)]).expressId;
  const solid = editor.addEntity('IfcSweptDiskSolid', schemaEntityAttributes(checked.registry, 'IfcSweptDiskSolid', {
    Directrix: `#${directrix}`,
    Radius: toNativeLength(anchor, params.OuterDiameter / 2),
    InnerRadius: params.InnerDiameter === undefined ? undefined : toNativeLength(anchor, params.InnerDiameter / 2),
  }, op)).expressId;
  const body = emitBody(editor, anchor, 'AdvancedSweptSolid', [solid]);
  const last = local.length - 1;
  const [startFlow, endFlow] = params.FlowDirections ?? ['NOTDEFINED', 'NOTDEFINED'];
  const [startName, endName] = params.PortNames ?? ['Start', 'End'];
  const port = (at: Vec3, toward: Vec3, flow: PortFlowDirection, name: string): DistributionPortParams => ({
    Location: at,
    Direction: sub(at, toward),
    FlowDirection: flow,
    PredefinedType: params.PortType ?? 'PIPE',
    SystemType: params.SystemType,
    Name: name,
  });
  const ports = params.Ports === false ? [] : [port(local[0], local[1], startFlow, startName), port(local[last], local[last - 1], endFlow, endName)];
  return emitElement(editor, anchor, params, checked, placementId, body, ports, op);
}

function emitAxis(editor: StoreEditor, anchor: SpatialAnchor, position: Vec3, axis?: readonly [number, number, number], refDirection?: readonly [number, number, number]): number {
  const point = editor.addEntity('IfcCartesianPoint', [toNativePoint3(anchor, position)]).expressId;
  const axes = completePlacementAxes(axis ? vec(axis) : undefined, refDirection ? vec(refDirection) : undefined);
  const z = axes ? `#${editor.addEntity('IfcDirection', [axes.Axis]).expressId}` : null;
  const x = axes ? `#${editor.addEntity('IfcDirection', [axes.RefDirection]).expressId}` : null;
  return editor.addEntity('IfcAxis2Placement3D', [`#${point}`, z, x]).expressId;
}

function emitSolid(editor: StoreEditor, anchor: SpatialAnchor, solid: DistributionSolidParams, op: string): { id: number; boolean: boolean } {
  assertFinitePoint3({ Position: vec(solid.Position) }, op);
  assertPositiveFinite([solid.Depth], `${op}: a solid's Depth must be a finite positive number`);
  if ((solid.Outline === undefined) === (solid.Radius === undefined)) throw new Error(`${op}: a solid needs either Outline or Radius`);
  let profile: number;
  if (solid.Radius !== undefined) {
    assertPositiveFinite([solid.Radius], `${op}: a solid's Radius must be a finite positive number`);
    const centre = editor.addEntity('IfcCartesianPoint', [[0, 0]]).expressId;
    const position = editor.addEntity('IfcAxis2Placement2D', [`#${centre}`, null]).expressId;
    profile = editor.addEntity('IfcCircleProfileDef', ['.AREA.', null, `#${position}`, toNativeLength(anchor, solid.Radius)]).expressId;
  } else {
    profile = emitPolygonProfile(editor, (solid.Outline ?? []).map((p) => toNativePoint2(anchor, p)));
  }
  const up = editor.addEntity('IfcDirection', [[0, 0, 1]]).expressId;
  const extruded = editor.addEntity('IfcExtrudedAreaSolid', [`#${profile}`, `#${emitAxis(editor, anchor, vec(solid.Position), solid.Axis, solid.RefDirection)}`, `#${up}`, toNativeLength(anchor, solid.Depth)]).expressId;
  const voids = solid.Voids ?? [];
  const id = voids.reduce((first, cut) => editor.addEntity('IfcBooleanResult', ['.DIFFERENCE.', `#${first}`, `#${emitSolid(editor, anchor, cut, op).id}`]).expressId, extruded);
  return { id, boolean: voids.length > 0 };
}

function addSolidElement(editor: StoreEditor, anchor: SpatialAnchor, params: SolidElementInStoreParams, op: string, supertype: string): DistributionElementBuildResult {
  assertFinitePoint3({ Position: vec(params.Position) }, op);
  if (params.Solids.length === 0) throw new Error(`${op}: Solids needs at least one solid`);
  const checked = checkedHeader(anchor, params, op, supertype);
  const placementId = emitLocalPlacement(
    editor,
    anchor.storeyPlacementId,
    toNativePoint3(anchor, params.Position),
    params.Axis ? vec(params.Axis) : undefined,
    params.RefDirection ? vec(params.RefDirection) : undefined,
  );
  const solids = params.Solids.map((solid) => emitSolid(editor, anchor, solid, op));
  const mixed = solids.some((s) => s.boolean) && !solids.every((s) => s.boolean);
  const type = mixed ? 'SolidModel' : solids.every((s) => s.boolean) ? 'CSG' : 'SweptSolid';
  const items = solids.map((s) => (mixed && s.boolean ? editor.addEntity('IfcCsgSolid', [`#${s.id}`]).expressId : s.id));
  const body = emitBody(editor, anchor, type, items);
  return emitElement(editor, anchor, params, checked, placementId, body, params.Ports ?? [], op);
}

export function addDistributionElementToStore(editor: StoreEditor, anchor: SpatialAnchor, params: DistributionElementInStoreParams): DistributionElementBuildResult {
  return addSolidElement(editor, anchor, params, 'addDistributionElementToStore', 'IfcDistributionElement');
}

export function addSolidElementToStore(editor: StoreEditor, anchor: SpatialAnchor, params: SolidElementInStoreParams): DistributionElementBuildResult {
  return addSolidElement(editor, anchor, params, 'addSolidElementToStore', 'IfcElement');
}
