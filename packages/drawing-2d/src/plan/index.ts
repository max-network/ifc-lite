/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export { generateStoreyPlan, type StoreyPlanOptions } from './storey-plan.js';
export { storeyCutElevation, DEFAULT_PLAN_CUT_HEIGHT, type StoreyCutFrame } from './storey-frame.js';
export {
  selectDrawableMeshes,
  PLAN_ELEMENT_FILTER,
  PLAN_EXCLUDED_TYPES,
  type DrawingElementFilter,
} from './element-filter.js';
export { buildOpeningSymbols, isOpeningFillingType, type OpeningSymbolOptions } from './opening-symbols.js';
export { buildSpaceAnnotations, type SpaceAnnotationOptions } from './space-annotations.js';
export {
  classifyMaterialName,
  roofingKindOf,
  resolveHatchPattern,
  MATERIAL_HATCH_PATTERNS,
  MEMBRANE_HATCH_PATTERN,
  type MaterialCategory,
  type ResolvedHatch,
  type RoofingKind,
} from './material-hatch.js';
export type { PlanSymbol, PlanSymbolKind, PlanLabel, PlanOpeningInfo, PlanAnnotations } from './plan-types.js';
export * from './dimensions/index.js';
