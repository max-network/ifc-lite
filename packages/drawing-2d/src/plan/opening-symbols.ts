/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Door swings and window frames for a plan, derived from the element meshes.
 *
 * The frame comes from the element's own placement (`MeshData.localToWorld`, Y-up,
 * row-major): local X runs along the wall and IFC local +Y, the side a door
 * swings to (IfcDoorTypeOperationEnum), is object-space -Z. Extents and centre are
 * measured on the world vertices along those axes, so the placement's pre-RTC
 * translation is never needed.
 */

import type { MeshData } from '@ifc-lite/geometry';
import type { Point2D, SectionPlaneConfig, OpeningInfo } from '../types.js';
import { makeEntityKey, type EntityKey } from '../types.js';
import { projectTo2D, vec3 } from '../math.js';
import { DoorSymbolGenerator } from '../symbols/door-symbol.js';
import { WindowSymbolGenerator } from '../symbols/window-symbol.js';
import { parseDoorOperation, parseWindowPartitioning } from '../openings/operation-types.js';
import type { PlanOpeningInfo, PlanSymbol } from './plan-types.js';

const DOOR_TYPES = new Set(['ifcdoor', 'ifcdoorstandardcase']);
const WINDOW_TYPES = new Set(['ifcwindow', 'ifcwindowstandardcase']);

/** Whether a mesh of this IFC type is drawn as a door or window symbol rather than cut. */
export function isOpeningFillingType(ifcType: string | undefined): boolean {
  const type = (ifcType ?? '').toLowerCase();
  return DOOR_TYPES.has(type) || WINDOW_TYPES.has(type);
}

export interface OpeningSymbolOptions {
  /** Render-frame Y of the plan cut. */
  cutY: number;
  plane: SectionPlaneConfig;
  /** Keyed by `makeEntityKey(modelIndex, expressId)`. */
  openings?: ReadonlyMap<EntityKey, PlanOpeningInfo>;
  /** Restrict symbols to these express ids (the storey's elements). Default: elements crossing the cut. */
  storeyElements?: ReadonlySet<number>;
}

interface Footprint {
  center: Point2D;
  along: Point2D;
  across: Point2D;
  width: number;
  depth: number;
  minY: number;
  maxY: number;
  placed: boolean;
}

const unit2 = (p: Point2D): Point2D | null => {
  const len = Math.hypot(p.x, p.y);
  return len > 1e-9 ? { x: p.x / len, y: p.y / len } : null;
};

/** Plan symbols for every door and window of `meshes` on this storey. Cardinal plan cuts only. */
export function buildOpeningSymbols(meshes: readonly MeshData[], options: OpeningSymbolOptions): PlanSymbol[] {
  const { plane } = options;
  if (plane.axis !== 'y' || plane.customPlane) return [];
  const groups = new Map<EntityKey, MeshData[]>();
  for (const mesh of meshes) {
    if (!isOpeningFillingType(mesh.ifcType)) continue;
    const key = makeEntityKey(mesh.modelIndex ?? 0, mesh.expressId);
    const group = groups.get(key);
    if (group) group.push(mesh);
    else groups.set(key, [mesh]);
  }

  const doorGenerator = new DoorSymbolGenerator();
  const windowGenerator = new WindowSymbolGenerator();
  const symbols: PlanSymbol[] = [];
  for (const [key, group] of groups) {
    const first = group[0];
    const footprint = measureFootprint(group, plane);
    if (!footprint) continue;
    const onStorey = options.storeyElements
      ? options.storeyElements.has(first.expressId)
      : footprint.minY < options.cutY && footprint.maxY > options.cutY;
    if (!onStorey) continue;

    const info = options.openings?.get(key);
    const isDoor = DOOR_TYPES.has((first.ifcType ?? '').toLowerCase());
    const width = info?.width ?? footprint.width;
    const opening: OpeningInfo = {
      type: isDoor ? 'door' : 'window',
      openingId: first.expressId,
      hostElementId: 0,
      fillingElementId: first.expressId,
      fillingType: first.ifcType,
      width,
      height: footprint.maxY - footprint.minY,
      bounds3D: { min: vec3(0, footprint.minY, 0), max: vec3(0, footprint.maxY, 0) },
      modelIndex: first.modelIndex ?? 0,
    };
    const base = { entityId: first.expressId, ifcType: first.ifcType ?? (isDoor ? 'IfcDoor' : 'IfcWindow'), modelIndex: opening.modelIndex };
    if (isDoor) {
      opening.doorOperation = parseDoorOperation(info?.operationType) ?? 'SINGLE_SWING_LEFT';
      const at = { min: footprint.center, max: footprint.center };
      const axes = footprint.placed ? { x: footprint.along, y: footprint.across } : undefined;
      const result = doorGenerator.generateFromOpening(opening, at, footprint.along, axes);
      symbols.push({ kind: 'door', ...base, lines: result.lines, symbol: { ...result.symbol, entityId: base.entityId } });
    } else {
      const partitioning = parseWindowPartitioning(info?.partitioningType) ?? 'SINGLE_PANEL';
      const thickness = info?.wallThickness ?? Math.max(footprint.depth, 1e-3);
      const result = windowGenerator.generateSymbol(footprint.center, width, thickness, footprint.along, footprint.across, partitioning);
      symbols.push({ kind: 'window', ...base, lines: result.lines, symbol: { ...result.symbol, entityId: base.entityId } });
    }
  }
  return symbols;
}

function placementAxes(mesh: MeshData, plane: SectionPlaneConfig): { along: Point2D; across: Point2D } | null {
  const m = mesh.localToWorld;
  if (!m || m.length !== 16) return null;
  const along = unit2(projectTo2D(vec3(m[0], m[4], m[8]), plane.axis, plane.flipped));
  const across = unit2(projectTo2D(vec3(-m[2], -m[6], -m[10]), plane.axis, plane.flipped));
  return along && across ? { along, across } : null;
}

function measureFootprint(group: readonly MeshData[], plane: SectionPlaneConfig): Footprint | null {
  const placed = placementAxes(group[0], plane);
  const points: Point2D[] = [];
  let minY = Infinity;
  let maxY = -Infinity;
  for (const mesh of group) {
    const o = mesh.origin ?? [0, 0, 0];
    const p = mesh.positions;
    for (let i = 0; i + 2 < p.length; i += 3) {
      const y = p[i + 1] + o[1];
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      points.push(projectTo2D(vec3(p[i] + o[0], y, p[i + 2] + o[2]), plane.axis, plane.flipped));
    }
  }
  if (points.length === 0) return null;
  const axes = placed ?? principalAxes(points);
  let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
  for (const q of points) {
    const s = q.x * axes.along.x + q.y * axes.along.y;
    const t = q.x * axes.across.x + q.y * axes.across.y;
    if (s < s0) s0 = s;
    if (s > s1) s1 = s;
    if (t < t0) t0 = t;
    if (t > t1) t1 = t;
  }
  const sm = (s0 + s1) / 2;
  const tm = (t0 + t1) / 2;
  return {
    center: { x: axes.along.x * sm + axes.across.x * tm, y: axes.along.y * sm + axes.across.y * tm },
    along: axes.along,
    across: axes.across,
    width: s1 - s0,
    depth: t1 - t0,
    minY,
    maxY,
    placed: placed !== null,
  };
}

/** Axis-aligned fallback without a placement: the longer plan extent runs along the wall. */
function principalAxes(points: readonly Point2D[]): { along: Point2D; across: Point2D } {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of points) {
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.y > y1) y1 = p.y;
  }
  return x1 - x0 >= y1 - y0
    ? { along: { x: 1, y: 0 }, across: { x: 0, y: 1 } }
    : { along: { x: 0, y: 1 }, across: { x: -1, y: 0 } };
}
