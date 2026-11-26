/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { generateIfcGuid } from '@ifc-lite/encoding';
import type { StoreEditor } from '@ifc-lite/mutations';
import { assertFinitePoint3 } from '../../ifc-creator-math.js';
import { toNativePoint3, type SpatialAnchor } from '../anchor.js';
import { emitLocalPlacement, ownerHistoryRef } from '../_emit-helpers.js';
import { schemaEntityAttributes, schemaRegistry } from '../schema-attributes.js';

export type Vec3 = [number, number, number];

export type PortFlowDirection = 'SOURCE' | 'SINK' | 'SOURCEANDSINK' | 'NOTDEFINED';

export interface DistributionPortParams {
  Location: readonly [number, number, number];
  Direction: readonly [number, number, number];
  FlowDirection?: PortFlowDirection;
  PredefinedType?: string;
  SystemType?: string;
  Name?: string;
}

export interface DistributionPortsInStoreParams {
  ElementId: number;
  ElementPlacementId: number;
  Ports: readonly DistributionPortParams[];
}

export interface DistributionPortsBuildResult {
  portIds: number[];
  nestsRelId: number | null;
}

export interface PortConnectionInStoreParams {
  RelatingPort: number;
  RelatedPort: number;
  RealizingElement?: number;
  Name?: string;
}

export function distributionRegistry(anchor: SpatialAnchor, op: string) {
  const registry = schemaRegistry(anchor.schema, op);
  if (registry.name.toUpperCase() === 'IFC2X3') throw new Error(`${op}: distribution elements and ports need IFC4 or later`);
  return registry;
}

function unit(v: readonly [number, number, number], op: string): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]);
  if (!Number.isFinite(length) || length < 1e-9) throw new Error(`${op}: a port Direction must be a finite non-zero vector`);
  return [v[0] / length, v[1] / length, v[2] / length];
}

export function addDistributionPortsToStore(
  editor: StoreEditor,
  anchor: SpatialAnchor,
  params: DistributionPortsInStoreParams,
): DistributionPortsBuildResult {
  const op = 'addDistributionPortsToStore';
  const registry = distributionRegistry(anchor, op);
  if (params.Ports.length === 0) return { portIds: [], nestsRelId: null };
  const owner = ownerHistoryRef(anchor.ownerHistoryId);
  const portIds = params.Ports.map((port, i) => {
    assertFinitePoint3({ [`Ports[${i}].Location`]: [port.Location[0], port.Location[1], port.Location[2]] }, op);
    const placement = emitLocalPlacement(editor, params.ElementPlacementId, toNativePoint3(anchor, port.Location), unit(port.Direction, op));
    return editor.addEntity('IfcDistributionPort', schemaEntityAttributes(registry, 'IfcDistributionPort', {
      GlobalId: generateIfcGuid(anchor.guidRandom),
      OwnerHistory: owner,
      Name: port.Name ?? `Port ${i + 1}`,
      ObjectPlacement: `#${placement}`,
      FlowDirection: port.FlowDirection ?? 'NOTDEFINED',
      PredefinedType: port.PredefinedType ?? 'PIPE',
      SystemType: port.SystemType,
    }, op)).expressId;
  });
  const nestsRelId = editor.addEntity('IfcRelNests', schemaEntityAttributes(registry, 'IfcRelNests', {
    GlobalId: generateIfcGuid(anchor.guidRandom),
    OwnerHistory: owner,
    RelatingObject: `#${params.ElementId}`,
    RelatedObjects: portIds.map((id) => `#${id}`),
  }, op)).expressId;
  return { portIds, nestsRelId };
}

export function connectPortsInStore(editor: StoreEditor, anchor: SpatialAnchor, params: PortConnectionInStoreParams): number {
  const op = 'connectPortsInStore';
  const registry = distributionRegistry(anchor, op);
  if (params.RelatingPort === params.RelatedPort) throw new Error(`${op}: a port cannot connect to itself`);
  return editor.addEntity('IfcRelConnectsPorts', schemaEntityAttributes(registry, 'IfcRelConnectsPorts', {
    GlobalId: generateIfcGuid(anchor.guidRandom),
    OwnerHistory: ownerHistoryRef(anchor.ownerHistoryId),
    Name: params.Name,
    RelatingPort: `#${params.RelatingPort}`,
    RelatedPort: `#${params.RelatedPort}`,
    RealizingElement: params.RealizingElement === undefined ? undefined : `#${params.RealizingElement}`,
  }, op)).expressId;
}
