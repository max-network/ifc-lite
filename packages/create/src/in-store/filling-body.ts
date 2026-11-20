/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The Body of an IfcDoor or IfcWindow, in the filling's frame (X along the
 * wall, Y across it, Z up; origin at the bottom centre of the leaf plane).
 *
 * `Detail: 'detailed'` (the default) writes the parts as separate extruded
 * solids in one SweptSolid representation, each with its own IfcStyledItem:
 * a window's lining ring, mullions/transoms and glazing panes; a door's
 * lining, leaves and handles. `Detail: 'box'` writes the single
 * `Width × FrameThickness × Height` solid. Either way the body spans the
 * same outline, so readers of the opening, the plan symbols and resizing see
 * the same extents.
 */

import type { StoreEditor } from '@ifc-lite/mutations';
import { toNativeLength, type SpatialAnchor } from './anchor.js';
import {
  assertPositiveFinite,
  emitBodyRepresentation,
  emitExtrudedSolid,
  emitPolygonProfile,
  emitRectangleProfile,
  emitRectangleRingProfile,
  emitSurfaceStyle,
  GLAZING_COLOR,
  type SurfaceStyleColor,
} from './_emit-helpers.js';
import { parseMaterialColor } from './material.js';
import { DEFAULT_LINING_THICKNESS, doorLayout, windowLayout, type FillingRect } from './filling-layout.js';

export type FillingDetail = 'detailed' | 'box';
export type FillingPartRole = 'lining' | 'mullion' | 'glazing' | 'leaf' | 'handle';
const COLOR_ROLES = ['lining', 'glazing', 'leaf', 'handle'] as const;
export type FillingColorRole = typeof COLOR_ROLES[number];

export interface FillingDetailParams {
  /** `detailed` (default): lining, panes or leaves and mullions as separately styled solids. `box`: one solid. */
  Detail?: FillingDetail;
  /** Face width of the lining, mullions and transoms (metres). Default 0.05, capped at a quarter of Width and Height. */
  LiningThickness?: number;
  /** Surface colour per part: a hex string (`#rrggbb`, `#rrggbbaa`) or channels in 0..1. Mullions take the lining's. */
  PartColors?: Partial<Record<FillingColorRole, SurfaceStyleColor | string>>;
}

export interface FillingPart {
  role: FillingPartRole;
  profileId: number;
  solidId: number;
  styledItemId: number;
}

export interface FillingBody {
  /** The lining's profile and solid (the box's, with `Detail: 'box'`). */
  profileId: number;
  solidId: number;
  shapeRepId: number;
  productShapeId: number;
  /** Every styled part; empty for a box. */
  parts: FillingPart[];
}

export interface FillingBodySpec extends FillingDetailParams {
  kind: 'door' | 'window';
  /** Metres. */
  Width: number;
  Height: number;
  FrameThickness: number;
  PartitioningType?: string;
  OperationType?: string;
  /** Doors: draw handles. Default true. */
  Handle?: boolean;
}

const DEFAULT_COLORS: Readonly<Record<FillingColorRole, SurfaceStyleColor>> = {
  lining: { red: 0.9, green: 0.9, blue: 0.88 },
  glazing: GLAZING_COLOR,
  leaf: { red: 0.78, green: 0.64, blue: 0.47 },
  handle: { red: 0.6, green: 0.61, blue: 0.63 },
};
const GLAZING_THICKNESS = 0.024;
const LEAF_THICKNESS = 0.04;
const HANDLE_PROJECTION = 0.05;
const snap = (x: number) => Math.round(x * 1e9) / 1e9;

type Shape =
  | { kind: 'rect'; rect: FillingRect }
  | { kind: 'ring'; width: number; height: number; wall: number }
  | { kind: 'outline'; points: Array<[number, number]> };

interface PartSpec {
  role: FillingPartRole;
  shape: Shape;
  depth: number;
}

function windowParts(spec: FillingBodySpec, lining: number, depth: number): PartSpec[] {
  const layout = windowLayout(spec.PartitioningType, spec.Width, spec.Height, lining);
  const glass = Math.min(GLAZING_THICKNESS, depth * 0.6);
  return [
    { role: 'lining', shape: { kind: 'ring', width: spec.Width, height: spec.Height, wall: layout.lining }, depth },
    ...layout.bars.map((rect): PartSpec => ({ role: 'mullion', shape: { kind: 'rect', rect }, depth })),
    ...layout.panes.map((rect): PartSpec => ({ role: 'glazing', shape: { kind: 'rect', rect }, depth: glass })),
  ];
}

function doorParts(spec: FillingBodySpec, lining: number, depth: number): PartSpec[] {
  const layout = doorLayout(spec.OperationType, spec.Width, spec.Height, lining, spec.Handle ?? true);
  const leaf = Math.min(LEAF_THICKNESS, depth * 0.8);
  return [
    { role: 'lining', shape: { kind: 'outline', points: layout.frame }, depth },
    ...layout.leaves.map((rect): PartSpec => ({ role: 'leaf', shape: { kind: 'rect', rect }, depth: leaf })),
    ...layout.handles.map((rect): PartSpec => ({ role: 'handle', shape: { kind: 'rect', rect }, depth: leaf + 2 * HANDLE_PROJECTION })),
  ];
}

/** Write the filling's Body. Dimensions are metres; the representation is in the anchor's native unit. */
export function emitFillingBody(
  editor: StoreEditor,
  anchor: Pick<SpatialAnchor, 'bodyContextId' | 'schema' | 'lengthUnitScale'>,
  spec: FillingBodySpec,
  op: string,
): FillingBody {
  const n = (metres: number) => snap(toNativeLength(anchor, metres));
  if (spec.Detail === 'box') {
    const profileId = emitRectangleProfile(editor, n(spec.Width), n(spec.FrameThickness));
    const solidId = emitExtrudedSolid(editor, profileId, n(spec.Height));
    return { profileId, solidId, ...emitBodyRepresentation(editor, anchor.bodyContextId, solidId), parts: [] };
  }
  if (spec.Detail !== undefined && spec.Detail !== 'detailed') throw new Error(`${op}: Detail must be 'detailed' or 'box'`);
  const lining = spec.LiningThickness ?? DEFAULT_LINING_THICKNESS;
  assertPositiveFinite([lining], `${op}: LiningThickness must be positive`);
  const colors = resolveColors(spec.PartColors, op);
  const parts = spec.kind === 'window' ? windowParts(spec, lining, spec.FrameThickness) : doorParts(spec, lining, spec.FrameThickness);

  const planeAxis = editor.addEntity('IfcDirection', [[0, -1, 0]]).expressId;
  const planeRef = editor.addEntity('IfcDirection', [[1, 0, 0]]).expressId;
  const extrusion = editor.addEntity('IfcDirection', [[0, 0, 1]]).expressId;
  const positions = new Map<number, number>();
  const position = (depth: number) => {
    let id = positions.get(depth);
    if (id === undefined) {
      const origin = editor.addEntity('IfcCartesianPoint', [[0, depth / 2, 0]]).expressId;
      id = editor.addEntity('IfcAxis2Placement3D', [`#${origin}`, `#${planeAxis}`, `#${planeRef}`]).expressId;
      positions.set(depth, id);
    }
    return id;
  };
  const styles = new Map<FillingColorRole, number>();
  const style = (role: FillingColorRole) => {
    let id = styles.get(role);
    if (id === undefined) {
      const label = `${spec.kind === 'door' ? 'Door' : 'Window'} ${role}`;
      id = emitSurfaceStyle(editor, anchor.schema ?? 'IFC4', colors[role], label).styleRefId;
      styles.set(role, id);
    }
    return id;
  };

  const written: FillingPart[] = parts.map((part) => {
    const profileId = emitShape(editor, part.shape, n);
    const depth = n(part.depth);
    const solidId = editor.addEntity('IfcExtrudedAreaSolid', [`#${profileId}`, `#${position(depth)}`, `#${extrusion}`, depth]).expressId;
    const colorRole: FillingColorRole = part.role === 'mullion' ? 'lining' : part.role;
    const styledItemId = editor.addEntity('IfcStyledItem', [`#${solidId}`, [`#${style(colorRole)}`], null]).expressId;
    return { role: part.role, profileId, solidId, styledItemId };
  });
  const { profileId, solidId } = written[0];
  return { profileId, solidId, ...emitBodyRepresentation(editor, anchor.bodyContextId, written.map((p) => p.solidId)), parts: written };
}

function emitShape(editor: StoreEditor, shape: Shape, n: (metres: number) => number): number {
  if (shape.kind === 'ring') return emitRectangleRingProfile(editor, n(shape.width), n(shape.height), n(shape.wall), 0, n(shape.height / 2));
  if (shape.kind === 'outline') return emitPolygonProfile(editor, shape.points.map(([x, z]) => [n(x), n(z)] as const));
  const { x0, z0, x1, z1 } = shape.rect;
  return emitRectangleProfile(editor, n(x1 - x0), n(z1 - z0), n((x0 + x1) / 2), n((z0 + z1) / 2));
}

function resolveColors(requested: FillingDetailParams['PartColors'], op: string): Record<FillingColorRole, SurfaceStyleColor> {
  const out = { ...DEFAULT_COLORS };
  for (const role of COLOR_ROLES) {
    const value = requested?.[role];
    if (value !== undefined) out[role] = parseMaterialColor(value, `${op}: PartColors.${role}`);
  }
  return out;
}
