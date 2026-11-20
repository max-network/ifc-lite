/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Anchored builder for IfcDoor — a free-standing rectangular leaf.
 *
 * This variant places a door without cutting an opening in any wall;
 * `addHostedDoorToStore` (hosted-fill.ts) cuts the opening and fills it.
 * The body (`emitFillingBody`) spans `Width × FrameThickness × Height`: a
 * lining, one leaf or two per OperationType and handles, or one box with
 * `Detail: 'box'`.
 *
 * The IFC4 IfcDoor entity adds `OverallHeight`, `OverallWidth`,
 * `PredefinedType`, `OperationType`, `UserDefinedOperationType` to
 * the IfcElement header. IFC2X3 stops at OverallHeight + OverallWidth
 * (no PredefinedType / OperationType slots).
 */

import type { StoreEditor } from '@ifc-lite/mutations';
import { assertFinitePoint3 } from '../ifc-creator-math.js';
import { toNativeLength, toNativePoint3, type SpatialAnchor } from './anchor.js';
import {
  assertPositiveFinite,
  emitLocalPlacement,
  emitRelContainedInSpatialStructure,
  ifcElementHeader,
} from './_emit-helpers.js';
import { emitFillingBody, type FillingDetailParams, type FillingPart } from './filling-body.js';

/**
 * IfcDoorTypeOperationEnum (IFC4). Anything outside this set is
 * normalised to USERDEFINED + UserDefinedOperationType so the exported
 * STEP carries a valid enum token.
 */
export const DOOR_OPERATION_ENUM: ReadonlySet<string> = new Set([
  'SINGLE_SWING_LEFT',
  'SINGLE_SWING_RIGHT',
  'DOUBLE_DOOR_SINGLE_SWING',
  'DOUBLE_DOOR_SINGLE_SWING_OPPOSITE_LEFT',
  'DOUBLE_DOOR_SINGLE_SWING_OPPOSITE_RIGHT',
  'DOUBLE_SWING_LEFT',
  'DOUBLE_SWING_RIGHT',
  'DOUBLE_DOOR_DOUBLE_SWING',
  'SLIDING_TO_LEFT',
  'SLIDING_TO_RIGHT',
  'DOUBLE_DOOR_SLIDING',
  'FOLDING_TO_LEFT',
  'FOLDING_TO_RIGHT',
  'DOUBLE_DOOR_FOLDING',
  'REVOLVING',
  'ROLLINGUP',
  'SWING_FIXED_LEFT',
  'SWING_FIXED_RIGHT',
  'USERDEFINED',
  'NOTDEFINED',
]);

export interface DoorInStoreParams extends FillingDetailParams {
  /** Bottom-centre of the door leaf, in storey-local coordinates. */
  Position: [number, number, number];
  Width: number;
  Height: number;
  /** Door leaf depth along storey-local +Y (metres). Defaults to 0.05. */
  FrameThickness?: number;
  /** IFC4 PredefinedType enum (without the dots). Defaults to NOTDEFINED. */
  PredefinedType?: 'DOOR' | 'GATE' | 'TRAPDOOR' | 'USERDEFINED' | 'NOTDEFINED';
  /** IFC4 OperationType enum (without the dots). Defaults to SINGLE_SWING_LEFT. */
  OperationType?: string;
  /** Free-text label when OperationType === 'USERDEFINED'. Ignored otherwise. */
  UserDefinedOperationType?: string;
  /** Draw a handle on each leaf (detailed body only). Defaults to true. */
  Handle?: boolean;
  Name?: string;
  Description?: string;
  ObjectType?: string;
  Tag?: string;
  /** Explicit GlobalId (22-char IFC GUID); generated when omitted. */
  GlobalId?: string;
}

export interface DoorBuildResult {
  doorId: number;
  placementId: number;
  profileId: number;
  solidId: number;
  shapeRepId: number;
  productShapeId: number;
  /** The body's styled parts; empty for `Detail: 'box'`. */
  parts: FillingPart[];
  relContainedId: number;
}

export function addDoorToStore(
  editor: StoreEditor,
  anchor: SpatialAnchor,
  params: DoorInStoreParams,
): DoorBuildResult {
  assertFinitePoint3({ Position: params.Position }, 'addDoorToStore');
  assertPositiveFinite([params.Width, params.Height], 'addDoorToStore: Width and Height must be positive');
  assertPositiveFinite(
    [params.FrameThickness ?? 0.05],
    'addDoorToStore: FrameThickness must be positive',
  );
  // Params are metres; convert dimensioned fields (incl. the OverallWidth/
  // OverallHeight attributes emitted below) to the file's native length
  // unit before emit (see SpatialAnchor.lengthUnitScale).
  const metres = { ...params, FrameThickness: params.FrameThickness ?? 0.05 };
  params = {
    ...params,
    Position: toNativePoint3(anchor, params.Position),
    Width: toNativeLength(anchor, params.Width),
    Height: toNativeLength(anchor, params.Height),
    FrameThickness: toNativeLength(anchor, params.FrameThickness ?? 0.05),
  };
  const placementId = emitLocalPlacement(editor, anchor.storeyPlacementId, params.Position);
  const { profileId, solidId, shapeRepId, productShapeId, parts } = emitFillingBody(editor, anchor, { ...metres, kind: 'door' }, 'addDoorToStore');

  const attrs = ifcElementHeader(anchor.ownerHistoryId, placementId, productShapeId, params, 'Door', anchor.guidRandom);
  attrs.push(...doorAttributeTail(anchor.schema, params));

  const doorId = editor.addEntity('IfcDoor', attrs as Parameters<StoreEditor['addEntity']>[1]).expressId;
  const relContainedId = emitRelContainedInSpatialStructure(editor, anchor.ownerHistoryId, doorId, anchor.storeyId, anchor.guidRandom);

  return { doorId, placementId, profileId, solidId, shapeRepId, productShapeId, parts, relContainedId };
}

/**
 * IfcDoor's attributes after the IfcElement header: OverallHeight and
 * OverallWidth in every schema, then PredefinedType / OperationType /
 * UserDefinedOperationType from IFC4 on. Shared by the hosted door builder.
 * `Height`/`Width` must already be in the native length unit.
 */
export function doorAttributeTail(
  schema: SpatialAnchor['schema'],
  params: Pick<DoorInStoreParams, 'Height' | 'Width' | 'PredefinedType' | 'OperationType' | 'UserDefinedOperationType'>,
): unknown[] {
  const tail: unknown[] = [params.Height, params.Width];
  if ((schema ?? 'IFC4') === 'IFC2X3') return tail;
  // Free-form values outside IfcDoorTypeOperationEnum are normalised
  // to USERDEFINED + UserDefinedOperationType so the exported STEP
  // carries a valid enum token rather than `.<value>.`.
  const requested = params.OperationType ?? 'SINGLE_SWING_LEFT';
  const isKnownEnum = DOOR_OPERATION_ENUM.has(requested);
  const operationType = isKnownEnum ? requested : 'USERDEFINED';
  const userDefined = operationType === 'USERDEFINED'
    ? (isKnownEnum ? params.UserDefinedOperationType ?? null : requested)
    : null;
  tail.push(`.${params.PredefinedType ?? 'NOTDEFINED'}.`, `.${operationType}.`, userDefined);
  return tail;
}
