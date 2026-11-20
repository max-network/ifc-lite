/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export {
  linearDimensionGraphics,
  linearDimensionLength,
  dimensionDirection,
  dimensionText,
  dimensionTextWidthMm,
  DIMENSION_PAPER_MM,
  type DimensionPt,
  type DimensionSegment,
  type DimensionOrientation,
  type LinearDimension,
  type DimensionGraphicsOptions,
  type DimensionGraphics,
} from './linear-dimension.js';
export {
  dimensionsToSvg,
  placeDimensionText,
  boundsWithDimensions,
  DIMENSION_STROKE_MM,
  DIMENSION_COLOR,
  type DimensionMapPoint,
  type PlacedDimensionText,
} from './dimension-svg.js';
