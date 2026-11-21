/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** Retire a product shape once no product points at it any more: after an
 * edit replaced the product's Representation, or after the product itself was
 * removed. IfcProductDefinitionShape.ShapeOfProduct is mandatory, and an
 * IfcShapeRepresentation belongs to exactly one product shape or map
 * (IfcShapeModel WR11), so leaving the old records behind exports a file
 * that fails schema validation. Only the representation structure is walked,
 * through its known reference slots, and a record anything live still
 * references is retained: shared type maps, contexts and shared styles stay.
 * An item referenced only by the IfcStyledItems that colour it goes with
 * them, and so does a style chain nothing else uses. */
import type { IfcDataStore } from '@ifc-lite/parser';
import type { StoreEditor } from '@ifc-lite/mutations';
import { effectiveReferencers } from '@ifc-lite/export';
import { AnchorEntityReader } from './resolve-anchor.js';
import { refId } from './host-geometry-frame.js';

/** Reference slots that lead to records this structure owns, by type. */
const OWNED_SLOTS: Readonly<Record<string, readonly number[]>> = {
  IFCPRODUCTDEFINITIONSHAPE: [2],
  IFCSHAPEREPRESENTATION: [3],
  IFCPOLYGONALFACESET: [0, 2],
  IFCTRIANGULATEDFACESET: [0],
  IFCMAPPEDITEM: [0, 1],
  IFCREPRESENTATIONMAP: [0, 1],
  IFCSTYLEDITEM: [1],
  IFCPRESENTATIONSTYLEASSIGNMENT: [0],
  IFCSURFACESTYLE: [2],
  IFCSURFACESTYLESHADING: [0],
  IFCSURFACESTYLERENDERING: [0],
};

const RETIRE_WORK_LIMIT = 100_000;

function slotRefs(value: unknown): number[] {
  return (Array.isArray(value) ? value : [value]).map(refId).filter((id): id is number => id !== null);
}

/**
 * Delete `shapeId` and the representation records only it reached, if no
 * live record references them. Returns the removed ids (empty when the shape
 * is still in use). Call it inside the same atomic edit that re-pointed or
 * removed the product.
 */
export function retireProductShape(store: IfcDataStore, editor: StoreEditor, shapeId: number): number[] {
  const view = editor.getMutationView();
  const reader = new AnchorEntityReader(store, view);
  const removed: number[] = [];
  const pending = [shapeId];
  let work = 0;
  while (pending.length > 0) {
    if (++work > RETIRE_WORK_LIMIT) throw new Error(`Retiring product shape #${shapeId} exceeds its work budget`);
    const id = pending.shift()!;
    const entity = reader.entity(id);
    if (!entity || entity.names.includes('GlobalId')) continue;
    const referencers = effectiveReferencers(store, view)(id);
    const stylers = referencers.flatMap(ref => {
      const styled = reader.entity(ref);
      return styled?.type.toUpperCase() === 'IFCSTYLEDITEM' && refId(styled.attributes[0]) === id ? [{ ref, styles: styled.attributes[1] }] : [];
    });
    if (referencers.length > stylers.length) continue;
    for (const styled of stylers) {
      if (!editor.removeEntity(styled.ref)) continue;
      removed.push(styled.ref);
      pending.push(...slotRefs(styled.styles));
    }
    if (!editor.removeEntity(id)) continue;
    removed.push(id);
    for (const slot of OWNED_SLOTS[entity.type.toUpperCase()] ?? []) pending.push(...slotRefs(entity.attributes[slot]));
  }
  return removed;
}
