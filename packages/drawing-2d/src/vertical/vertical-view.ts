/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Elevations and vertical sections of a building as construction sheets draw
 * them: an orthographic view along a horizontal direction, visible edges only,
 * the terrain as a ground line, and what lies in the ground dashed.
 */

import type { MeshData } from '@ifc-lite/geometry';
import type { RenderFrameInfo } from '@ifc-lite/geometry/world-frame';
import type { Drawing2D, DrawingLine, Line2D, Point2D } from '../types.js';
import { boundsEmpty, boundsExtendLine, boundsExtendPoint } from '../math.js';
import { Drawing2DGenerator, createSectionConfig, type GeneratorOptions } from '../drawing-generator.js';
import { PLAN_ELEMENT_FILTER, selectDrawableMeshes, type DrawingElementFilter } from '../plan/element-filter.js';
import { projectPointForPlane } from '../projection-bands.js';
import { worldBoundsCorners, worldBoundsOfMeshes } from '../view-plane.js';
import { verticalViewPlane, type VerticalPlane } from './plane.js';
import { TerrainOutline, alongRange, terrainCut, terrainEdges } from './terrain.js';

const MIN_BAND = 1e-3;
const PROFILE_STEP = 0.02;
const MIN_TERRAIN_MARGIN = 2;
const TERRAIN_MARGIN_SHARE = 0.25;

/** Which meshes are terrain by default: `IfcGeographicElement`, the type of a site's terrain. */
export const TERRAIN_FILTER: DrawingElementFilter = { includeTypes: ['IfcGeographicElement'] };

/** Hidden-line settings for a whole-building view: a finer raster, slope-tolerant bias and dense samples. */
export const VERTICAL_HIDDEN_LINE: GeneratorOptions['hiddenLine'] = { resolution: 2048, cellBias: 2, sampleSpacing: 0.05 };

export interface VerticalViewOptions {
  /** The horizontal direction the viewer looks, as an IFC world X/Y vector (X east, Y north). */
  direction: Point2D;
  /** The meshes' render frame (`GeometryResult.coordinateInfo`), so drawing coordinates are IFC world ones. */
  frame?: RenderFrameInfo | null;
  /** Drawing scale denominator. Default 100. */
  scale?: number;
  /** Which meshes are drawn. Default {@link PLAN_ELEMENT_FILTER}; terrain is always taken out. */
  elementFilter?: DrawingElementFilter;
  /** Which meshes are the terrain. Default {@link TERRAIN_FILTER}. */
  terrainFilter?: DrawingElementFilter;
  /** How far the terrain outline reaches beyond the building on each side, metres. Default a quarter of its width, at least 2 m. */
  terrainMargin?: number;
  /** Options passed through to {@link Drawing2DGenerator.generate}. */
  generator?: Partial<GeneratorOptions>;
}

export interface VerticalSectionOptions extends VerticalViewOptions {
  /** A point of the cut plane, IFC world X/Y metres. */
  through: Point2D;
}

/**
 * A vertical view. Drawing x is the distance along `right` from the IFC world
 * origin and drawing y is IFC world Z, both metres. Lines hidden by the
 * building are left out; lines in the ground are `visibility: 'hidden'`.
 */
export interface VerticalView extends Drawing2D {
  /** Drawing x direction, an IFC world X/Y unit vector. */
  right: Point2D;
  /** Viewing direction, an IFC world X/Y unit vector. */
  direction: Point2D;
  /** Signed distance of the picture plane from the IFC world origin along `direction`, metres. */
  planeOffset: number;
  /** The terrain's visible upper outline, broken where no terrain is seen. */
  terrain: Point2D[][];
  /** The terrain cut by the picture plane: the ground line of a section. */
  terrainCut: Line2D[];
}

function withoutTerrain(filter: DrawingElementFilter, terrain: ReadonlySet<number>): DrawingElementFilter {
  return { ...filter, excludeIds: new Set([...(filter.excludeIds ?? []), ...terrain]) };
}

async function generateVertical(meshes: readonly MeshData[], options: VerticalViewOptions, through?: Point2D): Promise<VerticalView> {
  const terrainMeshes = selectDrawableMeshes(meshes, options.terrainFilter ?? TERRAIN_FILTER);
  const terrainIds = new Set(terrainMeshes.map((mesh) => mesh.expressId));
  const filter = withoutTerrain(options.elementFilter ?? PLAN_ELEMENT_FILTER, terrainIds);
  const drawn = selectDrawableMeshes(meshes, filter);
  const bounds = worldBoundsOfMeshes(drawn);
  if (!bounds) throw new Error('Nothing to draw: the view has no building geometry.');
  const view: VerticalPlane = verticalViewPlane(options.direction, bounds, options.frame, through);
  const range = alongRange(
    worldBoundsCorners(bounds).map((corner) => projectPointForPlane(corner, view.plane)),
    (width) => options.terrainMargin ?? Math.max(MIN_TERRAIN_MARGIN, width * TERRAIN_MARGIN_SHARE),
  );
  const config = createSectionConfig(view.plane.axis, view.plane.position, {
    projectionDepth: view.viewDepth,
    projectionBelowDepth: view.viewDepth,
    projectionAboveDepth: MIN_BAND,
    clipProjectionBands: true,
    includeHiddenLines: false,
    scale: options.scale ?? 100,
  });
  config.plane = view.plane;
  const edges = range ? terrainEdges(terrainMeshes, view.plane, view.viewDepth, range) : [];
  const generator = new Drawing2DGenerator();
  let drawing: Drawing2D;
  try {
    await generator.initialize();
    drawing = await generator.generate(drawn, config, { useGPU: false, includeHiddenLines: false, hiddenLine: VERTICAL_HIDDEN_LINE, ...options.generator, elementFilter: filter, extraLines: edges });
  } finally {
    generator.dispose();
  }
  const cut = range ? terrainCut(terrainMeshes, view.plane, range) : [];
  const seen = drawing.lines.filter((line) => line.visibility === 'visible');
  const terrainSeen = seen.filter((line) => terrainIds.has(line.entityId));
  const outline = range ? new TerrainOutline([...terrainSeen, ...cut], range, PROFILE_STEP) : null;
  const building = seen.filter((line) => !terrainIds.has(line.entityId));
  const lines: DrawingLine[] = outline ? outline.bury(building) : building;
  let extent = boundsEmpty();
  for (const line of lines) extent = boundsExtendLine(extent, line.line);
  for (const polygon of drawing.cutPolygons) for (const point of polygon.polygon.outer) extent = boundsExtendPoint(extent, point);
  return {
    ...drawing,
    lines,
    bounds: extent,
    right: view.right,
    direction: view.direction,
    planeOffset: view.planeOffset,
    terrain: outline ? outline.polylines() : [],
    terrainCut: cut.map((line) => line.line),
  };
}

/** The elevation of a building seen along `direction` from in front of all of it. */
export function generateElevation(meshes: readonly MeshData[], options: VerticalViewOptions): Promise<VerticalView> {
  return generateVertical(meshes, options);
}

/** A vertical section through `through`, looking along `direction`: what the plane cuts, and what lies beyond it. */
export function generateVerticalSection(meshes: readonly MeshData[], options: VerticalSectionOptions): Promise<VerticalView> {
  return generateVertical(meshes, options, options.through);
}
