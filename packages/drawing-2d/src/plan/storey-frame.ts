/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { totalYupOffset, type RenderFrameInfo } from '@ifc-lite/geometry/world-frame';

/** Architectural plan cut height above the storey floor, metres. */
export const DEFAULT_PLAN_CUT_HEIGHT = 1.2;

/**
 * Render-frame Y of a plan cut `cutHeight` above a storey whose floor sits at
 * `storeyElevation` (IFC world Z, metres). Meshes are re-based by the wasm RTC
 * offset and the JS origin shift (`GeometryResult.coordinateInfo`), so a cut
 * height given in model terms must be moved into that frame before cutting.
 */
export function storeyCutElevation(
  storeyElevation: number,
  cutHeight: number = DEFAULT_PLAN_CUT_HEIGHT,
  frame?: RenderFrameInfo | null,
): number {
  return storeyElevation + cutHeight - totalYupOffset(frame).y;
}
