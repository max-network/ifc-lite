/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { HorizontalSegment } from '../landxml/alignment-mapping.js';
import type { VerticalSegment } from '../landxml/profile-geometry.js';
import { centrelineLength, centrelineSegments, horizontalAt, offsetFrom, polylineSelfIntersects, type PlanXY } from './horizontal.js';
import { corridorProfile, profileAt, type CorridorPvi, type ProfileCurve, type ProfileGrade } from './profile.js';
import { CorridorRefusal, type CorridorProblem } from './problems.js';
import { corridorStations, DEFAULT_CORRIDOR_TOLERANCE } from './sampling.js';

export type CrossFallSide = 'camber' | 'left' | 'right';

export interface CorridorKerb {
  /** Kerb top above the carriageway edge, metres. */
  Height: number;
  /** Kerb top width, metres. */
  Width: number;
}

/** A street, driveway or path: a centreline, its cross-section and its longitudinal profile, in metres and rise/run. */
export interface CorridorDefinition {
  Centreline: readonly PlanXY[];
  /** One radius per interior centreline vertex; a missing one is the largest smooth arc that fits. */
  Radii?: readonly (number | null)[];
  Width: number;
  CrossFall: number;
  CrossFallSide: CrossFallSide;
  Profile: readonly CorridorPvi[];
  MaxGrade: number;
  /** Metres of vertical curve per 1 % of grade change. */
  MinK: number;
  Kerb?: CorridorKerb;
  /** Largest chord deviation of the mesh from the true surface, metres. */
  Tolerance?: number;
}

export type CorridorPart = 'pavement' | 'kerbLeft' | 'kerbRight';

/** A line along the corridor: its offset left of the centreline and its height above the cross-fall surface. */
export interface SectionColumn {
  offset: number;
  raise: number;
}

export type CorridorTriangle = readonly [number, number, number];
export type CorridorVertex = readonly [number, number, number];

export interface CorridorMesh {
  /** Vertex `i * columns + c` is column `c` at station `i`. */
  positions: CorridorVertex[];
  pavement: CorridorTriangle[];
  kerbLeft: CorridorTriangle[];
  kerbRight: CorridorTriangle[];
}

export interface Corridor {
  definition: CorridorDefinition;
  horizontal: HorizontalSegment[];
  vertical: VerticalSegment[];
  length: number;
  stations: number[];
  tolerance: number;
  columns: SectionColumn[];
  mesh: CorridorMesh;
  /** The outer edge as one closed loop, 3D: what the terrain is fitted to. */
  outline: CorridorVertex[];
  grades: ProfileGrade[];
  curves: ProfileCurve[];
}

/** Rise of the surface at `offset` from the crown for a cross-fall (rise/run) falling to both sides or one. */
export function crossFallRise(offset: number, crossFall: number, side: CrossFallSide): number {
  if (side === 'camber') return -Math.abs(offset) * crossFall;
  return side === 'left' ? -offset * crossFall : offset * crossFall;
}

function sectionColumns(definition: CorridorDefinition): { columns: SectionColumn[]; parts: Record<CorridorPart, number[]> } {
  const half = definition.Width / 2;
  const kerb = definition.Kerb;
  const crown = definition.CrossFallSide === 'camber' ? [{ offset: 0, raise: 0 }] : [];
  const left = kerb ? [{ offset: half + kerb.Width, raise: kerb.Height }, { offset: half, raise: kerb.Height }] : [];
  const right = kerb ? [{ offset: -half, raise: kerb.Height }, { offset: -half - kerb.Width, raise: kerb.Height }] : [];
  const columns = [...left, { offset: half, raise: 0 }, ...crown, { offset: -half, raise: 0 }, ...right];
  const edge = left.length;
  const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const far = edge + crown.length + 1;
  return {
    columns,
    parts: {
      kerbLeft: kerb ? range(0, edge) : [],
      pavement: range(edge, far),
      kerbRight: kerb ? range(far, columns.length - 1) : [],
    },
  };
}

function surfaceZ(definition: CorridorDefinition, centre: number, column: SectionColumn): number {
  const half = definition.Width / 2;
  const clamped = Math.sign(column.offset) * Math.min(Math.abs(column.offset), half);
  return centre + crossFallRise(clamped, definition.CrossFall, definition.CrossFallSide) + column.raise;
}

function strip(columnsOfPart: readonly number[], stations: number, width: number): CorridorTriangle[] {
  const triangles: CorridorTriangle[] = [];
  for (let i = 0; i + 1 < stations; i++) {
    for (let k = 0; k + 1 < columnsOfPart.length; k++) {
      const [c, d] = [columnsOfPart[k], columnsOfPart[k + 1]];
      const [a, b, e, f] = [i * width + c, i * width + d, (i + 1) * width + d, (i + 1) * width + c];
      triangles.push([a, b, e], [a, e, f]);
    }
  }
  return triangles;
}

function capPoints(positions: readonly CorridorVertex[], row: number, width: number, columns: readonly SectionColumn[]): CorridorVertex[] {
  const out: CorridorVertex[] = [];
  for (let c = 1; c + 1 < width; c++) {
    const vertex = positions[row * width + c];
    const twin = out.length > 0 && Math.abs(columns[c].offset - columns[c - 1].offset) < 1e-12;
    if (twin) out[out.length - 1] = vertex[2] < out[out.length - 1][2] ? vertex : out[out.length - 1];
    else if (Math.abs(columns[c].offset - columns[0].offset) >= 1e-12 && Math.abs(columns[c].offset - columns[width - 1].offset) >= 1e-12) out.push(vertex);
  }
  return out;
}

function outlineOf(positions: readonly CorridorVertex[], stations: number, columns: readonly SectionColumn[]): CorridorVertex[] {
  const width = columns.length;
  const left = Array.from({ length: stations }, (_, i) => positions[i * width]);
  const right = Array.from({ length: stations }, (_, i) => positions[(stations - 1 - i) * width + width - 1]);
  return [...left, ...capPoints(positions, stations - 1, width, columns), ...right, ...capPoints(positions, 0, width, columns).reverse()];
}

function definitionProblems(definition: CorridorDefinition): CorridorProblem[] {
  const problems: CorridorProblem[] = [];
  if (!(definition.Width > 0)) problems.push({ code: 'width', values: { width: definition.Width } });
  if (definition.Kerb && !(definition.Kerb.Width > 0 && definition.Kerb.Height >= 0)) problems.push({ code: 'width', values: { kerbWidth: definition.Kerb.Width } });
  return problems;
}

function outerHalfWidth(definition: CorridorDefinition): number {
  return Math.max(0, definition.Width) / 2 + (definition.Kerb?.Width ?? 0);
}

interface Assembled {
  corridor: Corridor | null;
  problems: CorridorProblem[];
}

function assemble(definition: CorridorDefinition): Assembled {
  const problems = definitionProblems(definition);
  const halfOuter = outerHalfWidth(definition);
  const horizontal = centrelineSegments(definition.Centreline, definition.Radii ?? [], halfOuter);
  problems.push(...horizontal.problems);
  if (horizontal.problems.length === 0 && polylineSelfIntersects(definition.Centreline, false)) {
    problems.push({ code: 'self_intersecting', values: {} });
  }
  if (horizontal.segments.length === 0) return { corridor: null, problems };
  const length = centrelineLength(horizontal.segments);
  const profile = corridorProfile(definition.Profile, length, { maxGrade: definition.MaxGrade, minK: definition.MinK });
  problems.push(...profile.problems);
  if (problems.length > 0) return { corridor: null, problems };

  const { stations, tolerance } = corridorStations(horizontal.segments, profile.segments, length, {
    maxOffset: halfOuter, tolerance: definition.Tolerance ?? DEFAULT_CORRIDOR_TOLERANCE,
  });
  const { columns, parts } = sectionColumns(definition);
  const positions: CorridorVertex[] = stations.flatMap((s) => {
    const frame = horizontalAt(horizontal.segments, s);
    const centre = profileAt(profile.segments, s).height;
    return columns.map((column): CorridorVertex => {
      const [x, y] = offsetFrom(frame, column.offset);
      return [x, y, surfaceZ(definition, centre, column)];
    });
  });
  const outline = outlineOf(positions, stations.length, columns);
  if (polylineSelfIntersects(outline.map(([x, y]): PlanXY => [x, y]), true)) {
    return { corridor: null, problems: [{ code: 'self_intersecting', values: {} }] };
  }
  const width = columns.length;
  const mesh: CorridorMesh = {
    positions,
    pavement: strip(parts.pavement, stations.length, width),
    kerbLeft: strip(parts.kerbLeft, stations.length, width),
    kerbRight: strip(parts.kerbRight, stations.length, width),
  };
  return {
    corridor: {
      definition, horizontal: horizontal.segments, vertical: profile.segments, length, stations, tolerance,
      columns, mesh, outline, grades: profile.grades, curves: profile.curves,
    },
    problems,
  };
}

/** Every reason the definition cannot be built; empty when it can. */
export function corridorProblems(definition: CorridorDefinition): CorridorProblem[] {
  return assemble(definition).problems;
}

/** The corridor's alignment, mesh and outline: the one geometry its IFC body, plans, views and terrain fit all read. */
export function buildCorridor(definition: CorridorDefinition): Corridor {
  const { corridor, problems } = assemble(definition);
  if (!corridor) throw new CorridorRefusal(problems);
  return corridor;
}
