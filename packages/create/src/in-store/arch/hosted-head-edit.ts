/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { IfcDataStore } from '@ifc-lite/parser';
import type { StoreEditor } from '@ifc-lite/mutations';
import { fromNativeLength, toNativeLength, type HostAnchor } from '../anchor.js';
import { emitBodyRepresentation, emitExtrudedSolid, emitRectangleProfile } from '../_emit-helpers.js';
import { emitFillingBody } from '../filling-body.js';
import { num, refId } from '../host-geometry-frame.js';
import { retireProductShape } from '../product-shape-retire.js';
import { AnchorEntityReader } from '../resolve-anchor.js';
import { localBodyExtent } from '../resolve-host.js';
import type { HostedFillRead } from '../hosted-fill-read.js';
import { archedOpeningPath } from './arched-outline.js';
import { headRise, type OpeningHead } from './opening-head.js';
import { emitPathProfile } from './profile-path.js';

const EDGE = 1e-6;
const DEFAULT_FRAME_THICKNESS = 0.05;

interface Body {
  shapeId: number;
  contextId: number;
  items: number[];
}

function bodyOf(reader: AnchorEntityReader, productId: number): Body {
  const shapeId = refId(reader.entity(productId)?.attributes[6]);
  const reps = shapeId === null ? null : reader.entity(shapeId)?.attributes[2];
  const rep = Array.isArray(reps) && reps.length === 1 ? reader.entity(refId(reps[0]) ?? -1) : null;
  const contextId = refId(rep?.attributes[0]);
  const items = Array.isArray(rep?.attributes[3]) ? rep.attributes[3].map(refId) : [];
  if (shapeId === null || contextId === null || items.length === 0 || items.some((id) => id === null)) {
    throw new Error(`The body of #${productId} cannot be rebuilt with an arched head`);
  }
  return { shapeId, contextId, items: items.flatMap((id) => (id === null ? [] : [id])) };
}

function replaceShape(store: IfcDataStore, editor: StoreEditor, productId: number, oldShapeId: number, productShapeId: number): void {
  editor.setPositionalAttribute(productId, 6, `#${productShapeId}`);
  retireProductShape(store, editor, oldShapeId);
}

function attribute(reader: AnchorEntityReader, id: number, name: string): string | undefined {
  const entity = reader.entity(id);
  const value = entity ? entity.attributes[entity.names.indexOf(name)] : undefined;
  return typeof value === 'string' && value.length > 2 ? value.replace(/\./g, '') : undefined;
}

function frameThickness(reader: AnchorEntityReader, host: HostAnchor, body: Body): { thickness: number; detailed: boolean } {
  const solid = reader.entity(body.items[0]);
  const profile = solid ? reader.entity(refId(solid.attributes[0]) ?? -1) : null;
  const depth = num(solid?.attributes[3]);
  if (body.items.length === 1 && profile?.type.toUpperCase() === 'IFCRECTANGLEPROFILEDEF') {
    const y = num(profile.attributes[4]);
    if (y !== null && y > 0) return { thickness: y, detailed: false };
  }
  if (solid?.type.toUpperCase() !== 'IFCEXTRUDEDAREASOLID' || depth === null || depth <= 0) return { thickness: toNativeLength(host, DEFAULT_FRAME_THICKNESS), detailed: true };
  return { thickness: depth, detailed: body.items.length > 1 };
}

export interface HostedHeadRebuild {
  readonly width: number;
  readonly height: number;
  readonly head: OpeningHead | null;
}

export function rebuildHostedHead(store: IfcDataStore, editor: StoreEditor, host: HostAnchor, read: HostedFillRead, next: HostedHeadRebuild): void {
  const reader = new AnchorEntityReader(store, editor.getMutationView());
  const local = localBodyExtent(store, read.openingId, editor.getMutationView());
  const eps = toNativeLength(host, EDGE) * 10;
  if (!local || Math.abs(local.min[0] + local.max[0]) > eps || Math.abs(local.min[1]) > eps) {
    throw new Error(`Opening #${read.openingId} is not centred on its placement, so its head cannot be rebuilt`);
  }
  const width = toNativeLength(host, next.width);
  const height = toNativeLength(host, next.height);
  const rise = next.head ? toNativeLength(host, headRise(next.head, next.width, next.height, 'editHostedElementInStore')) : null;
  const opening = bodyOf(reader, read.openingId);
  const profile = rise === null
    ? emitRectangleProfile(editor, width, height, 0, height / 2)
    : emitPathProfile(editor, host.schema, archedOpeningPath({ width, height, rise }));
  const solid = emitExtrudedSolid(editor, profile, local.max[2] - local.min[2]);
  replaceShape(store, editor, read.openingId, opening.shapeId, emitBodyRepresentation(editor, opening.contextId, solid).productShapeId);
  if (read.fillingId === null) return;
  const filling = reader.entity(read.fillingId);
  const kind = filling?.type.toUpperCase() === 'IFCDOOR' ? 'door' : 'window';
  const body = bodyOf(reader, read.fillingId);
  const { thickness, detailed } = frameThickness(reader, host, body);
  const emitted = emitFillingBody(editor, { ...host, bodyContextId: body.contextId }, {
    kind,
    Width: next.width,
    Height: next.height,
    FrameThickness: fromNativeLength(host, thickness),
    Detail: detailed ? 'detailed' : 'box',
    ...(next.head ? { Head: next.head } : {}),
    ...(kind === 'door' ? { OperationType: attribute(reader, read.fillingId, 'OperationType') } : { PartitioningType: attribute(reader, read.fillingId, 'PartitioningType') }),
  }, 'editHostedElementInStore');
  replaceShape(store, editor, read.fillingId, body.shapeId, emitted.productShapeId);
}
