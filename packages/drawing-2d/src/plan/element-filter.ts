/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Which meshes a drawing draws.
 *
 * `GeometryResult.meshes` carries the whole scene: placed occurrences, but also
 * the type library (`IfcWallType` representation maps, meshed at the origin) and
 * non-fabric elements such as spaces, openings and the site. A drawing always
 * shows the building, so the type library is dropped by the same rule the
 * viewer's Model view applies (#2058), and a plan additionally drops what is not
 * building fabric.
 */

import type { MeshData } from '@ifc-lite/geometry';
import { geometryClassOf, isModelViewGeometryClass, isPlacedGeometryClass } from '@ifc-lite/geometry/geometry-class';
import { isFeatureElementType } from '../feature-elements.js';

export interface DrawingElementFilter {
  /** Keep type-library geometry (`geometryClass` 1/2). Default false. */
  includeTypeLibrary?: boolean;
  /** Drop `IfcFeatureElement` operands (openings, voids). Default false. */
  excludeFeatureElements?: boolean;
  /** IFC types to drop, matched case-insensitively. */
  excludeTypes?: readonly string[];
  /** When set, only these IFC types are kept, matched case-insensitively. */
  includeTypes?: readonly string[];
  /** Express ids to drop. */
  excludeIds?: ReadonlySet<number>;
}

/** IFC types a floor plan does not draw as building fabric. */
export const PLAN_EXCLUDED_TYPES: readonly string[] = [
  'IfcSpace',
  'IfcSpatialZone',
  'IfcSite',
  'IfcBuilding',
  'IfcBuildingStorey',
  'IfcAnnotation',
  'IfcGrid',
  'IfcVirtualElement',
];

/** The default filter of a storey plan. */
export const PLAN_ELEMENT_FILTER: DrawingElementFilter = {
  excludeFeatureElements: true,
  excludeTypes: PLAN_EXCLUDED_TYPES,
};

const lowerSet = (types?: readonly string[]) => (types ? new Set(types.map((t) => t.toLowerCase())) : undefined);

/** The meshes of `meshes` a drawing with `filter` draws, in their input order. */
export function selectDrawableMeshes<T extends MeshData>(meshes: readonly T[], filter: DrawingElementFilter = {}): T[] {
  const hasPlaced = meshes.some((m) => isPlacedGeometryClass(geometryClassOf(m)));
  const exclude = lowerSet(filter.excludeTypes);
  const include = lowerSet(filter.includeTypes);
  return meshes.filter((mesh) => {
    const geometryClass = geometryClassOf(mesh);
    if (!filter.includeTypeLibrary && !isModelViewGeometryClass(geometryClass, hasPlaced)) return false;
    if (filter.excludeIds?.has(mesh.expressId)) return false;
    const type = (mesh.ifcType ?? '').toLowerCase();
    if (filter.excludeFeatureElements && isFeatureElementType(type)) return false;
    if (exclude?.has(type)) return false;
    return !include || include.has(type);
  });
}
