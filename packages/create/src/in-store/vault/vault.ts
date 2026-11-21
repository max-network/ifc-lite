/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { IfcDataStore } from '@ifc-lite/parser';
import type { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import { toNativeLength, type SpatialAnchor } from '../anchor.js';
import { emitLocalPlacement, emitRelContainedInSpatialStructure, ifcElementHeader } from '../_emit-helpers.js';
import { getModelLengthUnitScale } from '../edit/length-unit-scale.js';
import { hostPlanFrame } from '../hosted-fill-read.js';
import { refId } from '../host-geometry-frame.js';
import { retireProductShape } from '../product-shape-retire.js';
import { AnchorEntityReader } from '../resolve-anchor.js';
import { archShape, type ArchKind } from '../arch/arch-shape.js';
import { emitVaultBody } from './vault-body.js';
import { VAULT_OBJECT_TYPE, readVaultDefinition, writeVaultDefinition, type VaultDefinition, type VaultShape, type VaultSpanAxis } from './vault-definition.js';

export interface VaultInStoreParams {
  Shape: VaultShape;
  Origin: [number, number];
  XDirection?: [number, number];
  Width: number;
  Depth: number;
  Springing: number;
  Crown: number;
  Thickness: number;
  SpanAxis?: VaultSpanAxis;
  Name?: string;
  Description?: string;
  Tag?: string;
  GlobalId?: string;
}

export interface VaultInStore extends VaultDefinition {
  Profile: ArchKind;
  Origin: [number, number];
  XDirection: [number, number];
  Springing: number;
  Crown: number;
}

export type VaultEdit = Partial<Omit<VaultInStoreParams, 'Name' | 'Description' | 'Tag' | 'GlobalId'>>;

function unitDirection(direction: [number, number] | undefined): [number, number] {
  const [x, y] = direction ?? [1, 0];
  const length = Math.hypot(x, y);
  if (!Number.isFinite(length) || length < 1e-9) throw new Error('A vault XDirection must be a finite, non-zero plan direction');
  return [x / length, y / length];
}

function definitionOf(params: Omit<VaultInStoreParams, 'Name' | 'Description' | 'Tag' | 'GlobalId'>): VaultDefinition & { direction: [number, number] } {
  const finite = [params.Width, params.Depth, params.Springing, params.Crown, params.Thickness, ...params.Origin];
  if (finite.some((value) => !Number.isFinite(value))) throw new Error('Vault dimensions must be finite');
  if (params.Width <= 0 || params.Depth <= 0) throw new Error('A vault needs a positive Width and Depth');
  if (params.Thickness <= 0) throw new Error('A vault needs a positive Thickness');
  if (params.Crown <= params.Springing) throw new Error(`The crown (${params.Crown}) must be above the springing (${params.Springing})`);
  if (params.Shape !== 'barrel' && params.Shape !== 'cross') throw new Error(`Vault Shape must be barrel or cross; got ${String(params.Shape)}`);
  const SpanAxis = params.SpanAxis ?? (params.Depth <= params.Width ? 'Y' : 'X');
  if (SpanAxis !== 'X' && SpanAxis !== 'Y') throw new Error(`Vault SpanAxis must be X or Y; got ${String(SpanAxis)}`);
  return { Shape: params.Shape, Width: params.Width, Depth: params.Depth, Rise: params.Crown - params.Springing, Thickness: params.Thickness, SpanAxis, direction: unitDirection(params.XDirection) };
}

export function addVaultToStore(editor: StoreEditor, anchor: SpatialAnchor, params: VaultInStoreParams): number {
  const definition = definitionOf(params);
  return editor.runAtomic((draft) => {
    const [dx, dy] = definition.direction;
    const placementId = emitLocalPlacement(draft, anchor.storeyPlacementId,
      [toNativeLength(anchor, params.Origin[0]), toNativeLength(anchor, params.Origin[1]), toNativeLength(anchor, params.Springing)],
      [0, 0, 1], [dx, dy, 0]);
    const { productShapeId } = emitVaultBody(draft, anchor, anchor.bodyContextId, definition);
    const attrs = ifcElementHeader(anchor.ownerHistoryId, placementId, productShapeId, { ...params, ObjectType: VAULT_OBJECT_TYPE }, 'Vault', anchor.guidRandom);
    const id = draft.addEntity('IfcSlab', [...attrs.map((value) => (typeof value === 'string' || value === null ? value : null)), '.USERDEFINED.']).expressId;
    emitRelContainedInSpatialStructure(draft, anchor.ownerHistoryId, id, anchor.storeyId, anchor.guidRandom);
    writeVaultDefinition(draft.getMutationView(), id, definition);
    return id;
  });
}

interface PlacementParts {
  pointId: number;
  refDirectionId: number;
}

function placementParts(reader: AnchorEntityReader, vaultId: number): PlacementParts {
  const placementId = refId(reader.entity(vaultId)?.attributes[5]);
  const axisId = placementId === null ? null : refId(reader.entity(placementId)?.attributes[1]);
  const axis = axisId === null ? null : reader.entity(axisId);
  const pointId = refId(axis?.attributes[0]);
  const refDirectionId = refId(axis?.attributes[2]);
  if (pointId === null || refDirectionId === null) throw new Error(`The placement of vault #${vaultId} cannot be edited`);
  return { pointId, refDirectionId };
}

export function readVaultInStore(store: IfcDataStore, vaultId: number, storeyId: number, view?: MutablePropertyView | null): VaultInStore | null {
  const reader = new AnchorEntityReader(store, view);
  const entity = reader.entity(vaultId);
  if (entity?.type.toUpperCase() !== 'IFCSLAB' || !view) return null;
  const definition = readVaultDefinition(view, vaultId);
  const frame = definition ? hostPlanFrame(store, vaultId, storeyId, view) : null;
  if (!definition || !frame) return null;
  const span = definition.Shape === 'cross' ? Math.min(definition.Width, definition.Depth) : definition.SpanAxis === 'Y' ? definition.Depth : definition.Width;
  return {
    ...definition,
    Profile: archShape(span, definition.Rise).kind,
    Origin: [frame.origin[0], frame.origin[1]],
    XDirection: frame.axisX,
    Springing: frame.origin[2],
    Crown: frame.origin[2] + definition.Rise,
  };
}

export function editVaultInStore(store: IfcDataStore, editor: StoreEditor, vaultId: number, storeyId: number, patch: VaultEdit): VaultInStore {
  return editor.runAtomic((draft) => {
    const view = draft.getMutationView();
    const current = readVaultInStore(store, vaultId, storeyId, view);
    if (!current) throw new Error(`#${vaultId} is not a vault made by addVaultToStore`);
    const springing = patch.Springing ?? current.Springing;
    const next = definitionOf({
      Shape: patch.Shape ?? current.Shape,
      Origin: patch.Origin ?? current.Origin,
      XDirection: patch.XDirection ?? current.XDirection,
      Width: patch.Width ?? current.Width,
      Depth: patch.Depth ?? current.Depth,
      Springing: springing,
      Crown: patch.Crown ?? springing + current.Rise,
      Thickness: patch.Thickness ?? current.Thickness,
      SpanAxis: patch.SpanAxis ?? (patch.Width !== undefined || patch.Depth !== undefined ? undefined : current.SpanAxis),
    });
    const reader = new AnchorEntityReader(store, view);
    const scale = { lengthUnitScale: getModelLengthUnitScale(store) };
    const shapeId = refId(reader.entity(vaultId)?.attributes[6]);
    const reps = shapeId === null ? null : reader.entity(shapeId)?.attributes[2];
    const repId = Array.isArray(reps) ? refId(reps[0]) : null;
    const contextId = repId === null ? null : refId(reader.entity(repId)?.attributes[0]);
    if (shapeId === null || contextId === null) throw new Error(`The body of vault #${vaultId} cannot be read`);
    const parts = placementParts(reader, vaultId);
    const origin = patch.Origin ?? current.Origin;
    draft.setPositionalAttribute(parts.pointId, 0, [toNativeLength(scale, origin[0]), toNativeLength(scale, origin[1]), toNativeLength(scale, springing)]);
    draft.setPositionalAttribute(parts.refDirectionId, 0, [next.direction[0], next.direction[1], 0]);
    const { productShapeId } = emitVaultBody(draft, { ...scale, schema: store.schemaVersion }, contextId, next);
    draft.setPositionalAttribute(vaultId, 6, `#${productShapeId}`);
    retireProductShape(store, draft, shapeId);
    writeVaultDefinition(view, vaultId, next);
    const updated = readVaultInStore(store, vaultId, storeyId, view);
    if (!updated) throw new Error(`Vault #${vaultId} could not be read back after the edit`);
    return updated;
  });
}
