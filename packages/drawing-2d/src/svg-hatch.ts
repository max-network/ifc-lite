/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The SVG exporter's hatching layer: cut polygons filled with a pattern per
 * `HatchPatternType`, plus explicit hatch lines from `HatchGenerator`.
 */

import type { DrawingPolygon, Point2D } from './types.js';
import type { HatchLine } from './hatch-generator.js';
import { HatchGenerator } from './hatch-generator.js';
import type { HatchPattern, HatchPatternType } from './styles.js';
import { transformPoint, type Transform2D } from './svg-transform.js';
import { escapeXml, svgNum } from './svg-format.js';
import { resolveHatchPattern, type MaterialCategory } from './plan/material-hatch.js';

type PatternBody = (s: number) => { size: number; transform?: string; body: string };

const stroke = (width: number, color = '#000') => `stroke="${color}" stroke-width="${width}"`;

/** One `<pattern>` per fillable type, id `hatch-<type>`; spacing `s` is in paper mm. */
const PATTERN_DEFS: Partial<Record<HatchPatternType, PatternBody>> = {
  diagonal: (s) => ({ size: s, transform: 'rotate(45)', body: `<line x1="0" y1="0" x2="0" y2="${s}" ${stroke(0.15)}/>` }),
  'cross-hatch': (s) => ({
    size: s,
    body: `<line x1="0" y1="0" x2="${s}" y2="${s}" ${stroke(0.1)}/><line x1="${s}" y1="0" x2="0" y2="${s}" ${stroke(0.1)}/>`,
  }),
  horizontal: (s) => ({ size: s, body: `<line x1="0" y1="${s / 2}" x2="${s}" y2="${s / 2}" ${stroke(0.1)}/>` }),
  vertical: (s) => ({ size: s, body: `<line x1="${s / 2}" y1="0" x2="${s / 2}" y2="${s}" ${stroke(0.1)}/>` }),
  concrete: (s) => ({
    size: s * 2,
    body: `<circle cx="${s * 0.3}" cy="${s * 0.3}" r="0.3" fill="#666"/>`
      + `<circle cx="${s * 1.3}" cy="${s * 1.3}" r="0.3" fill="#666"/>`
      + `<circle cx="${s * 0.8}" cy="${s * 1.6}" r="0.2" fill="#888"/>`,
  }),
  steel: (s) => ({ size: s * 0.7, transform: 'rotate(45)', body: `<line x1="0" y1="0" x2="0" y2="${s * 0.7}" ${stroke(0.2, '#333')}/>` }),
  brick: (s) => ({ size: s * 0.5, transform: 'rotate(45)', body: `<line x1="0" y1="0" x2="0" y2="${s * 0.5}" ${stroke(0.15)}/>` }),
  wood: (s) => ({ size: s * 0.7, transform: 'rotate(135)', body: `<line x1="0" y1="0" x2="0" y2="${s * 0.7}" ${stroke(0.1)}/>` }),
  earth: (s) => ({
    size: s,
    transform: 'rotate(45)',
    body: `<line x1="0" y1="0" x2="0" y2="${s / 2}" ${stroke(0.15, '#555')}/>`,
  }),
};

/** `<pattern>` definitions for every fillable hatch type, scaled like the drawing. */
export function createHatchPatternDefs(scaleFactor: number): string {
  const spacing = 3 * (scaleFactor / 100);
  let defs = '';
  for (const [type, make] of Object.entries(PATTERN_DEFS)) {
    if (!make) continue;
    const { size, transform, body } = make(spacing);
    const rotate = transform ? ` patternTransform="${transform}"` : '';
    defs += `    <pattern id="hatch-${type}" patternUnits="userSpaceOnUse" width="${size}" height="${size}"${rotate}>${body}</pattern>\n`;
  }
  return defs;
}

export function polygonToSvgPath(polygon: { outer: Point2D[]; holes: Point2D[][] }, transform: Transform2D): string {
  const ring = (points: Point2D[]): string => {
    if (points.length === 0) return '';
    return points
      .map((point, i) => {
        const p = transformPoint(point, transform);
        return `${i === 0 ? 'M' : 'L'} ${svgNum(p.x)} ${svgNum(p.y)}`;
      })
      .join(' ') + ' Z';
  };
  return [polygon.outer, ...polygon.holes].map(ring).filter((r) => r !== '').join(' ');
}

function polygonFill(pattern: HatchPattern): string {
  if (pattern.type === 'solid') return pattern.fillColor || '#CCCCCC';
  if (pattern.type === 'glass') return pattern.fillColor || 'rgba(200, 230, 255, 0.3)';
  return PATTERN_DEFS[pattern.type] ? `url(#hatch-${pattern.type})` : 'none';
}

function renderHatchLine(hatchLine: HatchLine, transform: Transform2D, pattern: HatchPattern): string {
  const p0 = transformPoint(hatchLine.line.start, transform);
  const p1 = transformPoint(hatchLine.line.end, transform);
  return `    <line x1="${svgNum(p0.x)}" y1="${svgNum(p0.y)}" x2="${svgNum(p1.x)}" y2="${svgNum(p1.y)}"
          stroke="${pattern.strokeColor}" stroke-width="${pattern.lineWeight}" stroke-linecap="butt"/>\n`;
}

/**
 * The hatching layer of a drawing. With `materialCategories` (keyed by
 * `materialId` or `entityId`) each cut is hatched by its material category,
 * otherwise by its IFC type.
 */
export function createHatchingLayer(
  polygons: DrawingPolygon[],
  transform: Transform2D,
  scaleFactor: number,
  materialCategories?: ReadonlyMap<number, MaterialCategory>,
): string {
  const hatchGenerator = new HatchGenerator();
  let layer = '  <g id="hatching" inkscape:label="Hatching" inkscape:groupmode="layer">\n';
  for (const polygon of polygons) {
    const { pattern, category } = resolveHatchPattern(polygon, materialCategories);
    if (pattern.type === 'none') continue;
    layer += `    <path d="${polygonToSvgPath(polygon.polygon, transform)}" fill="${polygonFill(pattern)}"
          stroke="${pattern.strokeColor}" stroke-width="${pattern.lineWeight}"
          data-entity-id="${polygon.entityId}" data-ifc-type="${escapeXml(polygon.ifcType)}" data-hatch="${category ?? pattern.type}"/>\n`;
    if (pattern.type === 'solid' || pattern.type === 'glass') continue;
    const custom = category ? { type: pattern.type, spacing: pattern.spacing, angle: pattern.angle, secondaryAngle: pattern.secondaryAngle } : undefined;
    for (const hatchLine of hatchGenerator.generateHatch(polygon, scaleFactor, custom).lines) {
      layer += renderHatchLine(hatchLine, transform, pattern);
    }
  }
  layer += '  </g>\n';
  return layer;
}
