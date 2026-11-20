/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { Drawing2D } from '../types.js';
import { transformPoint, type Transform2D } from '../svg-transform.js';
import { escapeXml, svgNum } from '../svg-format.js';
import { getLineStyle } from '../styles.js';
import type { PlanSymbolKind } from './plan-types.js';
import { dimensionsToSvg } from '../dimensions/dimension-svg.js';
import { planDimensionGraphics } from './dimensions/chains.js';

/** Pen per symbol kind: door/window linework as thin projection, room boundaries as fine dashed. */
const SYMBOL_PENS: Record<PlanSymbolKind, { weight: number; dash?: string; color: string }> = {
  door: { weight: getLineStyle('projection').weight, color: '#000000' },
  window: { weight: getLineStyle('projection').weight, color: '#000000' },
  space: { weight: 0.13, dash: '1.5 0.75', color: '#555555' },
};

/** Paper height of room labels, mm. */
const LABEL_HEIGHT_MM = 2.5;

/** The plan symbol, label and dimension layers of `drawing`, empty when it carries none. */
export function createPlanLayers(drawing: Drawing2D, transform: Transform2D, dimensions: { paperScale: number; format?: (metres: number) => string }): string {
  let svg = '';
  const symbols = drawing.planSymbols ?? [];
  if (symbols.length > 0) {
    svg += '  <g id="plan-symbols" inkscape:label="Symbols" inkscape:groupmode="layer" fill="none">\n';
    for (const symbol of symbols) {
      const pen = SYMBOL_PENS[symbol.kind];
      const dash = pen.dash ? ` stroke-dasharray="${pen.dash}"` : '';
      svg += `    <g data-entity-id="${symbol.entityId}" data-ifc-type="${escapeXml(symbol.ifcType)}" data-symbol="${symbol.kind}" stroke="${pen.color}" stroke-width="${pen.weight}" stroke-linecap="round"${dash}>\n`;
      for (const { start, end } of symbol.lines) {
        const a = transformPoint(start, transform);
        const b = transformPoint(end, transform);
        svg += `      <line x1="${svgNum(a.x)}" y1="${svgNum(a.y)}" x2="${svgNum(b.x)}" y2="${svgNum(b.y)}"/>\n`;
      }
      svg += '    </g>\n';
    }
    svg += '  </g>\n';
  }
  const labels = drawing.planLabels ?? [];
  if (labels.length > 0) {
    svg += `  <g id="plan-labels" inkscape:label="Labels" inkscape:groupmode="layer" font-family="Arial, sans-serif" font-size="${LABEL_HEIGHT_MM}" text-anchor="middle" dominant-baseline="central" fill="#000000">\n`;
    for (const label of labels) {
      const p = transformPoint(label.position, transform);
      svg += `    <text x="${svgNum(p.x)}" y="${svgNum(p.y)}" data-entity-id="${label.entityId}">${escapeXml(label.text)}</text>\n`;
    }
    svg += '  </g>\n';
  }
  const graphics = planDimensionGraphics(drawing.planDimensions ?? [], dimensions);
  svg += dimensionsToSvg(graphics, (x, y) => transformPoint({ x, y }, transform), (mm) => mm);
  return svg;
}
