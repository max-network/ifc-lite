/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Linear dimensions in the viewer's drawing exports. The geometry and the SVG
 * writer live in `@ifc-lite/drawing-2d`; the vector PDF writer stays here with
 * jsPDF. Callers pass only the dimensions on the cut now drawn
 * (`exportableDimensions`, via `useExportDimensions`).
 */

import type { jsPDF } from 'jspdf';
import {
  DIMENSION_COLOR,
  DIMENSION_STROKE_MM,
  isDxfDimensionExportable,
  linearDimensionGraphics,
  placeDimensionText,
  type DimensionGraphics,
  type DimensionGraphicsOptions,
  type DimensionMapPoint,
  type DimensionPt,
} from '@ifc-lite/drawing-2d';
import type { Dimension2D } from '@/store/slices/drawing2DDimensions';
import { pdfRotatedTextStart } from './pdf-text-placement';

/** DXF layer for dimension lines, ticks and values. */
export const DIMENSION_DXF_LAYER = 'IFC-DIMENSIONS';

/** The graphics of every dimension, in the order given. */
export function dimensionGraphicsList(dimensions: readonly Dimension2D[], options: DimensionGraphicsOptions): DimensionGraphics[] {
  return dimensions.map((dim) => linearDimensionGraphics(dim, options));
}

const PT_PER_MM = 72 / 25.4;

/** Draw the dimensions on a jsPDF page in millimetres; `map` takes drawing points to page mm (y down). */
export function drawDimensionsPdf(doc: jsPDF, graphics: readonly DimensionGraphics[], map: DimensionMapPoint): void {
  if (graphics.length === 0) return;
  doc.saveGraphicsState();
  doc.setDrawColor(DIMENSION_COLOR);
  doc.setTextColor(DIMENSION_COLOR);
  doc.setLineDashPattern([], 0);
  doc.setLineCap('butt');
  const stroke = (segments: readonly (readonly [DimensionPt, DimensionPt])[], widthMm: number) => {
    doc.setLineWidth(widthMm);
    for (const [p, q] of segments) {
      const a = map(p.x, p.y);
      const b = map(q.x, q.y);
      doc.line(a.x, a.y, b.x, b.y);
    }
  };
  for (const g of graphics.filter(isDxfDimensionExportable)) {
    stroke(g.lines, DIMENSION_STROKE_MM.line);
    stroke(g.ticks, DIMENSION_STROKE_MM.tick);
    const t = placeDimensionText(g.text, map);
    doc.setFontSize(t.size * PT_PER_MM);
    const start = pdfRotatedTextStart(t, (t.angleDeg * Math.PI) / 180, doc.getTextWidth(g.text.value), t.size,
      'center', 'middle');
    doc.text(g.text.value, start.x, start.y, { angle: -t.angleDeg });
  }
  doc.restoreGraphicsState();
}
