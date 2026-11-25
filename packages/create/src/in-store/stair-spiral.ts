/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { generateIfcGuid } from '@ifc-lite/encoding';
import type { StoreEditor } from '@ifc-lite/mutations';
import { assertFinitePoint3 } from '../ifc-creator-math.js';
import { toNativeLength, toNativePoint3, type SpatialAnchor } from './anchor.js';
import {
  assertPositiveFinite,
  emitBodyRepresentation,
  emitExtrudedSolid,
  emitLocalPlacement,
  emitRelContainedInSpatialStructure,
  ownerHistoryRef,
  productGuid,
} from './_emit-helpers.js';
import { circlePath, emitPathProfile, type ProfilePath, type Pt2 } from './arch/profile-path.js';
import { schemaAttributes, schemaEntityAttributes, schemaRegistry } from './schema-attributes.js';

export type SpiralTurn = 'ccw' | 'cw';

export interface SpiralStairInStoreParams {
  Centre: [number, number, number];
  OuterRadius: number;
  NewelRadius: number;
  StartAngle?: number;
  Turn?: SpiralTurn;
  NumberOfRisers: number;
  RiserHeight: number;
  TreadAngle: number;
  WalkingLineRadius: number;
  TreadThickness: number;
  PredefinedType?: string;
  Name?: string;
  Description?: string;
  ObjectType?: string;
  Tag?: string;
  GlobalId?: string;
  FlightGlobalId?: string;
}

export interface SpiralStairBuildResult {
  stairId: number;
  flightId: number;
  placementId: number;
  flightPlacementId: number;
  newelSolidId: number;
  treadSolidIds: number[];
  shapeRepId: number;
  productShapeId: number;
  relAggregatesId: number;
  relContainedId: number;
}

export interface SpiralStairEdges {
  inner: Array<[number, number, number]>;
  outer: Array<[number, number, number]>;
  walkingLine: Array<[number, number, number]>;
}

const polar = (radius: number, angle: number): Pt2 => [radius * Math.cos(angle), radius * Math.sin(angle)];

export function spiralTurnSign(turn: SpiralTurn | undefined): 1 | -1 {
  return turn === 'cw' ? -1 : 1;
}

export function spiralTreadPath(inner: number, outer: number, from: number, to: number): ProfilePath {
  const [low, high] = from <= to ? [from, to] : [to, from];
  const middle = (low + high) / 2;
  return {
    start: polar(inner, low),
    segments: [
      { kind: 'line', to: polar(outer, low) },
      { kind: 'arc', via: polar(outer, middle), to: polar(outer, high) },
      { kind: 'line', to: polar(inner, high) },
      { kind: 'arc', via: polar(inner, middle), to: polar(inner, low) },
    ],
  };
}

export function assertSpiralStairParams(params: SpiralStairInStoreParams, op: string): void {
  assertFinitePoint3({ Centre: params.Centre }, op);
  if (!Number.isInteger(params.NumberOfRisers) || params.NumberOfRisers < 2) {
    throw new Error(`${op}: NumberOfRisers must be an integer of at least 2`);
  }
  assertPositiveFinite(
    [params.OuterRadius, params.NewelRadius, params.RiserHeight, params.TreadAngle, params.WalkingLineRadius, params.TreadThickness],
    `${op}: OuterRadius, NewelRadius, RiserHeight, TreadAngle, WalkingLineRadius and TreadThickness must be finite positive numbers`,
  );
  if (params.NewelRadius >= params.OuterRadius) throw new Error(`${op}: NewelRadius must be smaller than OuterRadius`);
  if (params.WalkingLineRadius <= params.NewelRadius || params.WalkingLineRadius >= params.OuterRadius) {
    throw new Error(`${op}: WalkingLineRadius must lie between NewelRadius and OuterRadius`);
  }
  if (params.TreadAngle >= Math.PI) throw new Error(`${op}: TreadAngle must be less than half a turn`);
  if (params.StartAngle !== undefined && !Number.isFinite(params.StartAngle)) throw new Error(`${op}: StartAngle must be finite`);
  if (params.Turn !== undefined && params.Turn !== 'ccw' && params.Turn !== 'cw') throw new Error(`${op}: Turn must be ccw or cw`);
}

export function spiralStairEdges(params: SpiralStairInStoreParams): SpiralStairEdges {
  const sign = spiralTurnSign(params.Turn);
  const start = params.StartAngle ?? 0;
  const [cx, cy, cz] = params.Centre;
  const line = (radius: number) => Array.from({ length: params.NumberOfRisers + 1 }, (_, i): [number, number, number] => {
    const [x, y] = polar(radius, start + sign * i * params.TreadAngle);
    return [cx + x, cy + y, cz + Math.min(i + 1, params.NumberOfRisers) * params.RiserHeight];
  });
  return { inner: line(params.NewelRadius), outer: line(params.OuterRadius), walkingLine: line(params.WalkingLineRadius) };
}

export function addSpiralStairToStore(
  editor: StoreEditor,
  anchor: SpatialAnchor,
  params: SpiralStairInStoreParams,
): SpiralStairBuildResult {
  const op = 'addSpiralStairToStore';
  assertSpiralStairParams(params, op);
  const registry = schemaRegistry(anchor.schema, op);
  const isIfc2x3 = registry.name.toUpperCase() === 'IFC2X3';
  const stairGuid = productGuid(params, anchor.guidRandom);
  const flightGuid = productGuid({ GlobalId: params.FlightGlobalId }, anchor.guidRandom);
  const stairValues = (placement: string | null) => ({
    GlobalId: stairGuid,
    OwnerHistory: ownerHistoryRef(anchor.ownerHistoryId),
    Name: params.Name ?? 'Spiral stair',
    Description: params.Description,
    ObjectType: params.ObjectType,
    ObjectPlacement: placement,
    Tag: params.Tag,
    [isIfc2x3 ? 'ShapeType' : 'PredefinedType']: params.PredefinedType ?? 'SPIRAL_STAIR',
  });
  schemaAttributes(registry, 'IfcStair', stairValues(null), op);

  const native = (metres: number) => toNativeLength(anchor, metres);
  const start = params.StartAngle ?? 0;
  const sign = spiralTurnSign(params.Turn);
  const placementId = emitLocalPlacement(
    editor,
    anchor.storeyPlacementId,
    toNativePoint3(anchor, params.Centre),
    [0, 0, 1],
    [Math.cos(start), Math.sin(start), 0],
  );
  const flightPlacementId = emitLocalPlacement(editor, placementId, [0, 0, 0]);

  const inner = native(params.NewelRadius);
  const outer = native(params.OuterRadius);
  const riser = native(params.RiserHeight);
  const thickness = native(params.TreadThickness);
  const newelSolidId = emitExtrudedSolid(editor, emitPathProfile(editor, anchor.schema, circlePath(inner)), params.NumberOfRisers * riser);
  const treadSolidIds = Array.from({ length: params.NumberOfRisers }, (_, i) => {
    const path = spiralTreadPath(inner, outer, sign * i * params.TreadAngle, sign * (i + 1) * params.TreadAngle);
    return emitExtrudedSolid(editor, emitPathProfile(editor, anchor.schema, path), thickness, [0, 0, (i + 1) * riser - thickness]);
  });
  const { shapeRepId, productShapeId } = emitBodyRepresentation(editor, anchor.bodyContextId, [newelSolidId, ...treadSolidIds]);

  const stairId = editor.addEntity('IfcStair', schemaEntityAttributes(registry, 'IfcStair', stairValues(`#${placementId}`), op)).expressId;
  const flightId = editor.addEntity('IfcStairFlight', schemaEntityAttributes(registry, 'IfcStairFlight', {
    GlobalId: flightGuid,
    OwnerHistory: ownerHistoryRef(anchor.ownerHistoryId),
    Name: `${params.Name ?? 'Spiral stair'} Flight`,
    ObjectPlacement: `#${flightPlacementId}`,
    Representation: `#${productShapeId}`,
    [isIfc2x3 ? 'NumberOfRiser' : 'NumberOfRisers']: params.NumberOfRisers,
    NumberOfTreads: params.NumberOfRisers,
    RiserHeight: riser,
    TreadLength: native(params.WalkingLineRadius * params.TreadAngle),
    ...(isIfc2x3 ? {} : { PredefinedType: 'SPIRAL' }),
  }, op)).expressId;
  const relAggregatesId = editor.addEntity('IfcRelAggregates', schemaEntityAttributes(registry, 'IfcRelAggregates', {
    GlobalId: generateIfcGuid(anchor.guidRandom),
    OwnerHistory: ownerHistoryRef(anchor.ownerHistoryId),
    RelatingObject: `#${stairId}`,
    RelatedObjects: [`#${flightId}`],
  }, op)).expressId;
  const relContainedId = emitRelContainedInSpatialStructure(editor, anchor.ownerHistoryId, stairId, anchor.storeyId, anchor.guidRandom);
  return { stairId, flightId, placementId, flightPlacementId, newelSolidId, treadSolidIds, shapeRepId, productShapeId, relAggregatesId, relContainedId };
}
