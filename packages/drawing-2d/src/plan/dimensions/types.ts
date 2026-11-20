/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { DrawingPolygon, Point2D } from '../../types.js';
import type { LinearDimension } from '../../dimensions/linear-dimension.js';

export type PlanDimensionKind = 'openings' | 'grid' | 'overall' | 'interior';

/** A side of the building in its principal frame, as seen on paper (y down). */
export type PlanDimensionSide = 'top' | 'right' | 'bottom' | 'left';

/** A chain of linear dimensions sharing one dimension line. */
export interface PlanDimensionChain {
  kind: PlanDimensionKind;
  /** The facade an exterior chain dimensions; absent on interior chains. */
  side?: PlanDimensionSide;
  /** Unit direction of the chain in drawing space. */
  direction: Point2D;
  segments: LinearDimension[];
}

/** A grid axis in drawing space. */
export interface PlanGridAxis {
  tag: string;
  start: Point2D;
  end: Point2D;
}

export interface PlanDimensionOptions {
  /** Facades to dimension. Default all four. */
  sides?: readonly PlanDimensionSide[];
  /** Chain kinds to build. Default all. */
  kinds?: readonly PlanDimensionKind[];
  /** Grid axes for the grid chains. */
  grids?: readonly PlanGridAxis[];
  /** Which cut polygons are measured. Default walls, columns and curtain walls. */
  fabric?: (polygon: DrawingPolygon) => boolean;
  /** Formats a measured length in metres; used to keep texts apart. Default whole millimetres. */
  format?: (metres: number) => string;
  /** Paper distance from the outermost face to the first exterior chain, mm. Default 10. */
  firstOffsetMm?: number;
  /** Paper distance between exterior chain tiers, mm. Default 8. */
  tierSpacingMm?: number;
  /** Element types interior chains keep clear of. Default stairs, ramps, railings, furniture and fixtures. */
  obstacle?: (ifcType: string) => boolean;
  /** Thickest wall expected, metres: a gap whose jambs are no deeper is an opening, else a recess. Default 1. */
  maxWallThickness?: number;
}
