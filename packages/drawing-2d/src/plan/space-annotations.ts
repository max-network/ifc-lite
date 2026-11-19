/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { MeshData } from '@ifc-lite/geometry';
import type { DrawingPolygon, Line2D, Point2D, SectionPlaneConfig } from '../types.js';
import { makeEntityKey, type EntityKey } from '../types.js';
import { SectionCutter } from '../section-cutter.js';
import { polygonsAreaCentroid } from '../polygon-helpers.js';
import type { PlanLabel, PlanSymbol } from './plan-types.js';

export interface SpaceAnnotationOptions {
  plane: SectionPlaneConfig;
  /** Label text per space express id; a space without one gets a boundary only. */
  labels?: ReadonlyMap<number, string>;
  /** Restrict to these express ids (the storey's spaces). */
  storeyElements?: ReadonlySet<number>;
}

const ringLines = (ring: readonly Point2D[]): Line2D[] =>
  ring.map((start, i) => ({ start, end: ring[(i + 1) % ring.length] }));

/** Room boundaries (the spaces' section at the cut) and a label at each room's centroid. */
export function buildSpaceAnnotations(
  spaces: readonly MeshData[],
  options: SpaceAnnotationOptions,
): { symbols: PlanSymbol[]; labels: PlanLabel[] } {
  const members = options.storeyElements
    ? spaces.filter((m) => options.storeyElements?.has(m.expressId))
    : spaces;
  const polygons = new SectionCutter(options.plane).cutMeshes([...members]).polygons;
  const byEntity = new Map<EntityKey, DrawingPolygon[]>();
  for (const polygon of polygons) {
    const key = makeEntityKey(polygon.modelIndex, polygon.entityId);
    const group = byEntity.get(key);
    if (group) group.push(polygon);
    else byEntity.set(key, [polygon]);
  }

  const symbols: PlanSymbol[] = [];
  const labels: PlanLabel[] = [];
  for (const group of byEntity.values()) {
    const { entityId, modelIndex, ifcType } = group[0];
    const lines = group.flatMap(({ polygon }) => [polygon.outer, ...polygon.holes].flatMap(ringLines));
    symbols.push({ kind: 'space', entityId, ifcType, modelIndex, lines });
    const text = options.labels?.get(entityId)?.trim();
    const position = polygonsAreaCentroid(group);
    if (text && position) labels.push({ kind: 'space', entityId, modelIndex, text, position });
  }
  return { symbols, labels };
}
