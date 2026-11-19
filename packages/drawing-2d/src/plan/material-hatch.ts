/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Section poché by material category, the drafting convention a plan's cut
 * elements are hatched by (concrete, masonry, insulation, timber, ...), with the
 * per-IFC-type pattern as the default when no material is known.
 */

import type { DrawingPolygon } from '../types.js';
import { getHatchPattern, type HatchPattern } from '../styles.js';

export type MaterialCategory =
  | 'concrete'
  | 'masonry'
  | 'insulation'
  | 'timber'
  | 'steel'
  | 'gypsum'
  | 'stone'
  | 'glass'
  | 'earth';

/**
 * Name keywords per category (English, German, French, Dutch). Order matters: a more
 * specific family wins over a word it contains ("Steinwolle" is insulation,
 * "Kalksandstein" and "Porenbeton" are masonry units).
 */
const MATERIAL_KEYWORDS: ReadonlyArray<readonly [MaterialCategory, RegExp]> = [
  ['insulation', /insulat|d[äa]e?mm|mineral\s?wo|glas\s?wo|stein\s?wo|rock\s?wool|polystyr|\b(eps|xps|pur|pir)\b|isolant|isolation|isolatie/i],
  ['masonry', /mason|brick|block|mauerwerk|ziegel|klinker|kalksand|calcium silicate|sand-?lime|kalkzandsteen|metselwerk|baksteen|poren\s?beton|gas\s?beton|aerated|ytong|brique|parpaing/i],
  ['concrete', /concrete|beton|screed|estrich|cement|zement|b[ée]ton/i],
  ['timber', /timber|wood|lumber|plywood|\bosb\b|\bclt\b|glulam|holz|sperrholz|brettsperr|brettschicht|bois|\bhout/i],
  ['steel', /steel|stahl|metal|alumin|iron|eisen|acier|staal/i],
  ['gypsum', /gypsum|gips|plaster|putz|drywall|pl[âa]tre/i],
  ['stone', /stone|granit|marble|marmor|naturstein|sandstein|limestone|kalkstein|pierre/i],
  ['glass', /glass|glas|glazing|verglas|verre/i],
  ['earth', /earth|soil|erdreich|gravel|kies|terre/i],
];

/** The drafting category a material name belongs to, or undefined when none is recognised. */
export function classifyMaterialName(name: string | undefined | null): MaterialCategory | undefined {
  if (!name) return undefined;
  for (const [category, pattern] of MATERIAL_KEYWORDS) if (pattern.test(name)) return category;
  return undefined;
}

const line = { lineWeight: 0.18, strokeColor: '#000000' } as const;

/** Section hatch per material category (spacing in mm at 1:100, as `HATCH_PATTERNS`). */
export const MATERIAL_HATCH_PATTERNS: Readonly<Record<MaterialCategory, HatchPattern>> = {
  concrete: { type: 'concrete', spacing: 3.0, angle: 45, ...line },
  masonry: { type: 'brick', spacing: 1.5, angle: 45, ...line },
  insulation: { type: 'insulation', spacing: 2.0, angle: 0, lineWeight: 0.13, strokeColor: '#000000' },
  timber: { type: 'wood', spacing: 2.0, angle: 135, ...line },
  steel: { type: 'steel', spacing: 1.0, angle: 45, lineWeight: 0.18, strokeColor: '#333333' },
  gypsum: { type: 'horizontal', spacing: 1.5, angle: 0, lineWeight: 0.13, strokeColor: '#000000' },
  stone: { type: 'cross-hatch', spacing: 3.0, angle: 45, secondaryAngle: 135, ...line },
  glass: { type: 'glass', spacing: 0, angle: 0, lineWeight: 0.13, strokeColor: '#000000', fillColor: 'rgba(200, 230, 255, 0.3)' },
  earth: { type: 'earth', spacing: 4.0, angle: 45, lineWeight: 0.13, strokeColor: '#555555' },
};

export interface ResolvedHatch {
  pattern: HatchPattern;
  /** The material category the pattern came from, when one applied. */
  category?: MaterialCategory;
}

/**
 * The hatch of one cut polygon: its material category (looked up by the layer's
 * `materialId`, then by the element's `entityId`) when known, else the IFC type's.
 */
export function resolveHatchPattern(
  polygon: DrawingPolygon,
  categories?: ReadonlyMap<number, MaterialCategory>,
): ResolvedHatch {
  const category = categories
    ? (polygon.materialId !== undefined ? categories.get(polygon.materialId) : undefined) ?? categories.get(polygon.entityId)
    : undefined;
  return category ? { pattern: MATERIAL_HATCH_PATTERNS[category], category } : { pattern: getHatchPattern(polygon.ifcType) };
}
