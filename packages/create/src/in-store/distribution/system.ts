/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { StoreEditor } from '@ifc-lite/mutations';
import type { SpatialAnchor } from '../anchor.js';
import { ownerHistoryRef, productGuid } from '../_emit-helpers.js';
import { canonicalEntity, conformsTo, schemaEntityAttributes } from '../schema-attributes.js';
import { distributionRegistry } from './ports.js';

export interface DistributionSystemInStoreParams {
  Type?: string;
  Name: string;
  PredefinedType?: string;
  LongName?: string;
  Description?: string;
  ObjectType?: string;
  GlobalId?: string;
  ServicedBuildings?: readonly number[];
  PartOf?: number;
}

export interface DistributionSystemBuildResult {
  systemId: number;
  servicesRelId: number | null;
  aggregatesRelId: number | null;
}

export interface ProductAssignmentInStoreParams {
  ProductId: number;
  ObjectIds: readonly number[];
}

export interface GroupAssignmentInStoreParams {
  GroupId: number;
  ObjectIds: readonly number[];
}

export function addDistributionSystemToStore(editor: StoreEditor, anchor: SpatialAnchor, params: DistributionSystemInStoreParams): DistributionSystemBuildResult {
  const op = 'addDistributionSystemToStore';
  const registry = distributionRegistry(anchor, op);
  const owner = ownerHistoryRef(anchor.ownerHistoryId);
  const type = canonicalEntity(registry, params.Type ?? 'IfcDistributionSystem');
  if (!type || !conformsTo(registry, type, 'IfcDistributionSystem')) throw new Error(`${op}: ${params.Type} is not an IfcDistributionSystem in ${registry.name}`);
  if (params.PartOf !== undefined && !Number.isInteger(params.PartOf)) throw new Error(`${op}: PartOf must be an entity id`);
  const systemId = editor.addEntity(type, schemaEntityAttributes(registry, type, {
    GlobalId: productGuid(params, anchor.guidRandom),
    OwnerHistory: owner,
    Name: params.Name,
    Description: params.Description,
    ObjectType: params.ObjectType,
    LongName: params.LongName,
    PredefinedType: params.PredefinedType,
  }, op)).expressId;
  const buildings = params.ServicedBuildings ?? [];
  const servicesRelId = buildings.length === 0 ? null : editor.addEntity('IfcRelServicesBuildings', schemaEntityAttributes(registry, 'IfcRelServicesBuildings', {
    GlobalId: productGuid({}, anchor.guidRandom),
    OwnerHistory: owner,
    RelatingSystem: `#${systemId}`,
    RelatedBuildings: buildings.map((id) => `#${id}`),
  }, op)).expressId;
  const aggregatesRelId = params.PartOf === undefined ? null : editor.addEntity('IfcRelAggregates', schemaEntityAttributes(registry, 'IfcRelAggregates', {
    GlobalId: productGuid({}, anchor.guidRandom),
    OwnerHistory: owner,
    RelatingObject: `#${params.PartOf}`,
    RelatedObjects: [`#${systemId}`],
  }, op)).expressId;
  return { systemId, servicesRelId, aggregatesRelId };
}

export function assignToGroupInStore(editor: StoreEditor, anchor: SpatialAnchor, params: GroupAssignmentInStoreParams): number {
  const op = 'assignToGroupInStore';
  const registry = distributionRegistry(anchor, op);
  const ids = [...new Set(params.ObjectIds)];
  if (ids.length === 0) throw new Error(`${op}: pass at least one object id`);
  if (ids.includes(params.GroupId)) throw new Error(`${op}: a group cannot hold itself`);
  return editor.addEntity('IfcRelAssignsToGroup', schemaEntityAttributes(registry, 'IfcRelAssignsToGroup', {
    GlobalId: productGuid({}, anchor.guidRandom),
    OwnerHistory: ownerHistoryRef(anchor.ownerHistoryId),
    RelatedObjects: ids.map((id) => `#${id}`),
    RelatingGroup: `#${params.GroupId}`,
  }, op)).expressId;
}

export function assignToProductInStore(editor: StoreEditor, anchor: SpatialAnchor, params: ProductAssignmentInStoreParams): number {
  const op = 'assignToProductInStore';
  const registry = distributionRegistry(anchor, op);
  const ids = [...new Set(params.ObjectIds)];
  if (ids.length === 0) throw new Error(`${op}: pass at least one object id`);
  if (ids.includes(params.ProductId)) throw new Error(`${op}: a product cannot be assigned to itself`);
  return editor.addEntity('IfcRelAssignsToProduct', schemaEntityAttributes(registry, 'IfcRelAssignsToProduct', {
    GlobalId: productGuid({}, anchor.guidRandom),
    OwnerHistory: ownerHistoryRef(anchor.ownerHistoryId),
    RelatedObjects: ids.map((id) => `#${id}`),
    RelatingProduct: `#${params.ProductId}`,
  }, op)).expressId;
}
