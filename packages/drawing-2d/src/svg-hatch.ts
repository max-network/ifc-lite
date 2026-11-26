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
import type { HatchPattern } from './styles.js';
import { transformPoint, type Transform2D } from './svg-transform.js';
import { escapeXml, svgNum } from './svg-format.js';
import { resolveHatchPattern, type MaterialCategory } from './plan/material-hatch.js';

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
  return pattern.type === 'insulation' || pattern.type === 'none' ? 'none' : `url(#hatch-${pattern.type})`;
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
