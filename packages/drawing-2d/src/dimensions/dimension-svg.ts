/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { isDxfDimensionExportable } from '../dxf-exporter.js';
import { escapeXml, svgNum } from '../svg-format.js';
import type { DimensionGraphics, DimensionPt } from './linear-dimension.js';

/** Stroke weights in paper millimetres: thin dimension and extension lines, heavier ticks. */
export const DIMENSION_STROKE_MM = { line: 0.18, tick: 0.35 } as const;
export const DIMENSION_COLOR = '#000000';

/** Maps a drawing point (metres, un-flipped) to an output point. */
export type DimensionMapPoint = (x: number, y: number) => DimensionPt;

/** Where and how a dimension's text sits in a y-down output frame (SVG, PDF page). */
export interface PlacedDimensionText {
  x: number;
  y: number;
  /** Baseline angle in degrees, clockwise on the page (y down), in (-90, 90]: upright. */
  angleDeg: number;
  /** Text height in output units. */
  size: number;
}

/** Place a dimension's text in a y-down output frame, measuring baseline and size through `map`. */
export function placeDimensionText(text: DimensionGraphics['text'], map: DimensionMapPoint): PlacedDimensionText {
  const at = map(text.at.x, text.at.y);
  const tip = map(text.at.x + Math.cos(text.angle) * text.heightM, text.at.y + Math.sin(text.angle) * text.heightM);
  let dx = tip.x - at.x;
  let dy = tip.y - at.y;
  if (dx < -1e-12 || (Math.abs(dx) <= 1e-12 && dy > 0)) {
    dx = -dx;
    dy = -dy;
  }
  return { x: at.x, y: at.y, angleDeg: (Math.atan2(dy, dx) * 180) / Math.PI + 0, size: Math.hypot(dx, dy) };
}

/** `bounds` grown to hold every dimension; the text is covered by a square as wide as a generous estimate of the value. */
export function boundsWithDimensions<B extends { min: DimensionPt; max: DimensionPt }>(bounds: B, graphics: readonly DimensionGraphics[]): B {
  if (graphics.length === 0) return bounds;
  let { x: minX, y: minY } = bounds.min;
  let { x: maxX, y: maxY } = bounds.max;
  const grow = (p: DimensionPt, r = 0) => {
    minX = Math.min(minX, p.x - r);
    minY = Math.min(minY, p.y - r);
    maxX = Math.max(maxX, p.x + r);
    maxY = Math.max(maxY, p.y + r);
  };
  for (const g of graphics.filter(isDxfDimensionExportable)) {
    for (const [p, q] of [...g.lines, ...g.ticks]) {
      grow(p);
      grow(q);
    }
    grow(g.text.at, (g.text.heightM * Math.max(1, 0.7 * g.text.value.length)) / 2);
  }
  return { ...bounds, min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
}

const n = (v: number) => svgNum(v + 0, 4);

/** The dimensions as one SVG group; `map` takes drawing points to SVG user units, `mmToUnits` paper millimetres to them. */
export function dimensionsToSvg(graphics: readonly DimensionGraphics[], map: DimensionMapPoint, mmToUnits: (mm: number) => number): string {
  if (graphics.length === 0) return '';
  const segment = ([p, q]: readonly [DimensionPt, DimensionPt], width: number) => {
    const a = map(p.x, p.y);
    const b = map(q.x, q.y);
    return `<line x1="${n(a.x)}" y1="${n(a.y)}" x2="${n(b.x)}" y2="${n(b.y)}" stroke-width="${n(width)}"/>`;
  };
  const lineW = mmToUnits(DIMENSION_STROKE_MM.line);
  const tickW = mmToUnits(DIMENSION_STROKE_MM.tick);
  let svg = `  <g id="dimensions" stroke="${DIMENSION_COLOR}" stroke-linecap="butt" fill="none">\n`;
  for (const g of graphics.filter(isDxfDimensionExportable)) {
    const t = placeDimensionText(g.text, map);
    svg += '    <g class="dimension">';
    svg += g.lines.map((s) => segment(s, lineW)).join('') + g.ticks.map((s) => segment(s, tickW)).join('');
    svg += `<text x="${n(t.x)}" y="${n(t.y)}" transform="rotate(${n(t.angleDeg)} ${n(t.x)} ${n(t.y)})" font-family="Arial, sans-serif" font-size="${n(t.size)}" fill="${DIMENSION_COLOR}" stroke="none" text-anchor="middle" dominant-baseline="central">${escapeXml(g.text.value)}</text>`;
    svg += '</g>\n';
  }
  return svg + '  </g>\n';
}
