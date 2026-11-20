/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import type { MutablePropertyView } from '@ifc-lite/mutations';
import { extractPropertiesOnDemand, type IfcDataStore } from '@ifc-lite/parser';
import type { GeometryEntityReader } from '../host-geometry-frame.js';
import { refId } from '../host-geometry-frame.js';
export const ROOF_ATTACHMENT = 'IfcLite_RoofAttachment';
/** Whether our roof cut is recorded on the wall, read from the overlay or, without one, from the file's own property sets. */
export function isRoofClipped(store: IfcDataStore, view: MutablePropertyView | null | undefined, wallId: number): boolean {
  if (view) return view.getPropertyValue(wallId, ROOF_ATTACHMENT, 'Clipped') === true;
  return extractPropertiesOnDemand(store, wallId).some((set) => set.name === ROOF_ATTACHMENT
    && set.properties.some((property) => property.name === 'Clipped' && property.value === true));
}
/** Only our recorded roof cuts expose an editable base extrusion. Never unwrap arbitrary imported CSG. */
export function wallBaseSolid(reader: GeometryEntityReader, clipped: boolean, root: number | null): number | null {
  if (root === null || !clipped) return root;
  const visited = new Set<number>();
  let id: number | null = root;
  while (id !== null) {
    if (visited.has(id)) return null;
    visited.add(id);
    const entity = reader.entity(id);
    if (entity?.type.toUpperCase() !== 'IFCBOOLEANRESULT') return id;
    if (entity.attributes[0] !== '.DIFFERENCE.' && entity.attributes[0] !== 'DIFFERENCE') return null;
    id = refId(entity.attributes[1]);
  }
  return null;
}
