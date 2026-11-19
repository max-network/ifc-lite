/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Sheet-quality metrics of one storey plan, read off the drawing and its SVG
 * only, so the same measurement runs against any version of the library.
 */

import type { MeshData } from '@ifc-lite/geometry';
import type { Drawing2D } from '../../src/types.js';
import type { FixtureStorey, PlanFixture } from './fixture.js';

export interface PlanMetrics {
  fixture: string;
  storey: string;
  pipeline: string;
  cutModelZ: number;
  expectedCutModelZ: number;
  cutAtModelHeight: boolean;
  wallsCrossing: number;
  wallsCut: number;
  missingWalls: number[];
  typeLibraryItems: number;
  nonFabricPolygons: number;
  doorsOnStorey: number;
  doorSymbols: number;
  windowsOnStorey: number;
  windowSymbols: number;
  spacesOnCut: number;
  spacesLabelled: number;
  cutWallsHatched: number;
  wallsMaterialHatched: number;
}

const MATERIAL_HATCHES = new Set(['concrete', 'masonry', 'insulation', 'timber', 'steel', 'gypsum', 'stone', 'glass', 'earth']);
const NON_FABRIC = /^(ifcspace|ifcopeningelement|ifcsite|ifc\w*type)$/i;
const isWall = (type: string | undefined) => /^ifcwall/i.test(type ?? '') && !/type$/i.test(type ?? '');
const isPlaced = (mesh: MeshData) => mesh.geometryClass === undefined || mesh.geometryClass === 0 || mesh.geometryClass === 3;

function verticalRanges(meshes: readonly MeshData[]): Map<number, [number, number]> {
  const ranges = new Map<number, [number, number]>();
  for (const mesh of meshes) {
    if (!isPlaced(mesh)) continue;
    const oy = mesh.origin?.[1] ?? 0;
    const range = ranges.get(mesh.expressId) ?? [Infinity, -Infinity];
    for (let i = 1; i < mesh.positions.length; i += 3) {
      const y = mesh.positions[i] + oy;
      if (y < range[0]) range[0] = y;
      if (y > range[1]) range[1] = y;
    }
    ranges.set(mesh.expressId, range);
  }
  return ranges;
}

function ringArea(ring: readonly { x: number; y: number }[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

/** `data-entity-id` → `data-hatch` (or `fill` when the attribute is absent) of the hatching layer's paths. */
function hatchedEntities(svg: string): Map<number, string> {
  const start = svg.indexOf('id="hatching"');
  const hatched = new Map<number, string>();
  if (start < 0) return hatched;
  const layer = svg.slice(start, svg.indexOf('</g>', start));
  for (const match of layer.matchAll(/<path [^>]*?data-entity-id="(\d+)"[^>]*\/>/g)) {
    const element = match[0];
    const hatch = /data-hatch="([^"]+)"/.exec(element)?.[1] ?? /fill="([^"]+)"/.exec(element)?.[1] ?? 'none';
    if (hatch !== 'none') hatched.set(Number(match[1]), hatch);
  }
  return hatched;
}

export function measurePlan(
  fixture: PlanFixture,
  storey: FixtureStorey,
  pipeline: string,
  drawing: Drawing2D,
  svg: string,
  renderOffsetY: number,
  cutHeight: number,
): PlanMetrics {
  const cutY = drawing.config.plane.position;
  const intendedY = storey.elevation + cutHeight - renderOffsetY;
  const ranges = verticalRanges(fixture.meshes);
  const typeLibraryIds = new Set(fixture.meshes.filter((m) => !isPlaced(m)).map((m) => m.expressId));
  for (const mesh of fixture.meshes) if (isPlaced(mesh)) typeLibraryIds.delete(mesh.expressId);

  const crossing = [...ranges].filter(([id, [lo, hi]]) => isWall(fixture.ifcTypeOf.get(id)) && lo < intendedY && hi > intendedY).map(([id]) => id);
  const cutIds = new Set(drawing.cutPolygons.filter((p) => p.polygon.outer.length >= 3 && ringArea(p.polygon.outer) > 1e-8).map((p) => p.entityId));
  const wallsCut = crossing.filter((id) => cutIds.has(id));

  const placedOfType = (prefix: string) => [...storey.elements].filter((id) => ranges.has(id) && (fixture.ifcTypeOf.get(id) ?? '').toLowerCase().startsWith(prefix));
  const doors = placedOfType('ifcdoor');
  const windows = placedOfType('ifcwindow');
  const symbolIds = (kind: string) => new Set((drawing.planSymbols ?? []).filter((s) => s.kind === kind).map((s) => s.entityId));
  const doorSymbols = symbolIds('door');
  const windowSymbols = symbolIds('window');

  const spaces = placedOfType('ifcspace').filter((id) => {
    const [lo, hi] = ranges.get(id) ?? [0, 0];
    return lo < intendedY && hi > intendedY && fixture.spaceLabels.has(id);
  });
  const labelled = new Set((drawing.planLabels ?? []).map((l) => l.entityId));
  const hatched = hatchedEntities(svg);
  const typeLibraryItems = drawing.cutPolygons.filter((p) => typeLibraryIds.has(p.entityId)).length
    + drawing.lines.filter((l) => typeLibraryIds.has(l.entityId)).length;

  return {
    fixture: fixture.name,
    storey: storey.name,
    pipeline,
    cutModelZ: cutY + renderOffsetY,
    expectedCutModelZ: storey.elevation + cutHeight,
    cutAtModelHeight: Math.abs(cutY + renderOffsetY - (storey.elevation + cutHeight)) < 1e-6,
    wallsCrossing: crossing.length,
    wallsCut: wallsCut.length,
    missingWalls: crossing.filter((id) => !cutIds.has(id)),
    typeLibraryItems,
    nonFabricPolygons: drawing.cutPolygons.filter((p) => NON_FABRIC.test(p.ifcType)).length,
    doorsOnStorey: doors.length,
    doorSymbols: doors.filter((id) => doorSymbols.has(id)).length,
    windowsOnStorey: windows.length,
    windowSymbols: windows.filter((id) => windowSymbols.has(id)).length,
    spacesOnCut: spaces.length,
    spacesLabelled: spaces.filter((id) => labelled.has(id)).length,
    cutWallsHatched: wallsCut.filter((id) => hatched.has(id)).length,
    wallsMaterialHatched: wallsCut.filter((id) => MATERIAL_HATCHES.has(hatched.get(id) ?? '')).length,
  };
}
