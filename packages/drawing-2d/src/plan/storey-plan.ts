/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A storey floor plan as a construction sheet draws it: cut storey-relative at
 * `cutHeight` above the floor in model coordinates, building fabric only, doors
 * and windows as symbols in their openings, rooms as boundaries with labels.
 */

import type { MeshData } from '@ifc-lite/geometry';
import type { Drawing2D, Line2D, ProfileEntry } from '../types.js';
import { boundsExtendLine, boundsExtendPoint } from '../math.js';
import { Drawing2DGenerator, createSectionConfig, type GeneratorOptions } from '../drawing-generator.js';
import { PLAN_ELEMENT_FILTER, selectDrawableMeshes, type DrawingElementFilter } from './element-filter.js';
import { DEFAULT_PLAN_CUT_HEIGHT, storeyCutElevation, type StoreyCutFrame } from './storey-frame.js';
import { buildOpeningSymbols, isOpeningFillingType } from './opening-symbols.js';
import { buildSpaceAnnotations } from './space-annotations.js';
import type { PlanLabel, PlanOpeningInfo, PlanSymbol } from './plan-types.js';
import { buildPlanDimensions, planDimensionGraphics } from './dimensions/chains.js';
import type { PlanDimensionOptions } from './dimensions/types.js';

export interface StoreyPlanOptions {
  /** `IfcBuildingStorey.Elevation` in metres, relative to the building placement (e.g. `SpatialHierarchy.storeyElevations`); give the building's Z as `frame.buildingOrigin`. */
  storeyElevation: number;
  /** Cut height above the floor, metres. Default 1.2. */
  cutHeight?: number;
  /** Floor-to-floor height, metres: bounds the dashed overhead band. Without it nothing overhead is drawn. */
  storeyHeight?: number;
  /** The meshes' render frame (`GeometryResult.coordinateInfo`), so the cut lands in model coordinates. */
  frame?: StoreyCutFrame | null;
  /** Drawing scale denominator. Default 100. */
  scale?: number;
  /** Which meshes are drawn. Default {@link PLAN_ELEMENT_FILTER}. */
  elementFilter?: DrawingElementFilter;
  /** Draw doors and windows as symbols instead of cutting their bodies. Default true. */
  openingSymbols?: boolean;
  /** Operation type, width and host thickness per door/window express id. */
  openings?: ReadonlyMap<number, PlanOpeningInfo>;
  /** The storey's element ids: symbols and labels are limited to them. Default: what crosses the cut. */
  storeyElements?: ReadonlySet<number>;
  /** Draw spaces as room boundaries, labelled from `labels`. Omit to leave spaces out. */
  spaces?: { labels?: ReadonlyMap<number, string> };
  /** Dimension the plan: facade chains (openings, grid, overall) and interior chains. Omit for none. */
  dimensions?: PlanDimensionOptions;
  /** Options passed through to {@link Drawing2DGenerator.generate}. */
  generator?: Partial<GeneratorOptions>;
  /** Extruded profiles for clean projection lines, as {@link Drawing2DGenerator.generate} takes them. */
  profiles?: ProfileEntry[];
}

const MIN_BAND = 1e-3;

/** Generate the floor plan of one storey. */
export async function generateStoreyPlan(meshes: readonly MeshData[], options: StoreyPlanOptions): Promise<Drawing2D> {
  const cutHeight = options.cutHeight ?? DEFAULT_PLAN_CUT_HEIGHT;
  const position = storeyCutElevation(options.storeyElevation, cutHeight, options.frame);
  const above = options.storeyHeight !== undefined ? options.storeyHeight - cutHeight : 0;
  const config = createSectionConfig('y', position, {
    projectionDepth: cutHeight,
    projectionBelowDepth: Math.max(cutHeight, MIN_BAND),
    projectionAboveDepth: Math.max(above, MIN_BAND),
    clipProjectionBands: true,
    scale: options.scale ?? 100,
  });

  const filter = options.elementFilter ?? PLAN_ELEMENT_FILTER;
  const drawable = selectDrawableMeshes(meshes, filter);
  const symbolize = options.openingSymbols ?? true;
  const fabric = symbolize ? drawable.filter((m) => !isOpeningFillingType(m.ifcType)) : drawable;

  const generator = new Drawing2DGenerator();
  let drawing: Drawing2D;
  try {
    await generator.initialize();
    drawing = await generator.generate(fabric, config, { useGPU: false, ...options.generator, elementFilter: filter }, options.profiles);
  } finally {
    generator.dispose();
  }

  const symbols: PlanSymbol[] = symbolize
    ? buildOpeningSymbols(drawable, { cutY: position, plane: config.plane, openings: options.openings, storeyElements: options.storeyElements })
    : [];
  const labels: PlanLabel[] = [];
  if (options.spaces) {
    const spaces = selectDrawableMeshes(meshes, { includeTypes: ['IfcSpace'] });
    const rooms = buildSpaceAnnotations(spaces, { plane: config.plane, labels: options.spaces.labels, storeyElements: options.storeyElements });
    symbols.push(...rooms.symbols);
    labels.push(...rooms.labels);
  }

  const planDimensions = options.dimensions ? buildPlanDimensions({ ...drawing, planSymbols: symbols, planLabels: labels }, options.dimensions) : [];

  let bounds = drawing.bounds;
  const symbolLines: Line2D[] = symbols.flatMap((s) => s.lines);
  for (const line of symbolLines) bounds = boundsExtendLine(bounds, line);
  for (const label of labels) bounds = boundsExtendPoint(bounds, label.position);
  for (const graphic of planDimensionGraphics(planDimensions, { paperScale: config.scale, format: options.dimensions?.format })) {
    for (const [start, end] of [...graphic.lines, ...graphic.ticks]) bounds = boundsExtendLine(bounds, { start, end });
    bounds = boundsExtendPoint(bounds, graphic.text.at);
  }
  return { ...drawing, planSymbols: symbols, planLabels: labels, planDimensions, bounds };
}
