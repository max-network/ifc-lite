/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { HatchGenerator } from './hatch-generator.js';
import { insulationZigzag, layerBand } from './insulation-hatch.js';
import { MATERIAL_HATCH_PATTERNS } from './plan/material-hatch.js';
import { exportToSVG } from './svg-exporter.js';
import { DEFAULT_SECTION_CONFIG, type Drawing2D, type DrawingPolygon, type Point2D } from './types.js';

const strip = (angleDeg: number, length: number, thickness: number): Point2D[] => {
  const a = (angleDeg * Math.PI) / 180;
  const u = { x: Math.cos(a), y: Math.sin(a) };
  const v = { x: -u.y, y: u.x };
  return [
    { x: 0, y: 0 },
    { x: u.x * length, y: u.y * length },
    { x: u.x * length + v.x * thickness, y: u.y * length + v.y * thickness },
    { x: v.x * thickness, y: v.y * thickness },
  ];
};

const insulation = (outer: Point2D[]): DrawingPolygon => ({ polygon: { outer, holes: [] }, entityId: 7, ifcType: 'IfcCovering', modelIndex: 0, isCut: true });

describe('insulation hatch', () => {
  it('finds the long axis and the thickness of a rotated layer', () => {
    const band = layerBand(strip(30, 4, 0.16));
    expect(band?.length).toBeCloseTo(4, 6);
    expect(band?.thickness).toBeCloseTo(0.16, 6);
    expect(Math.abs((band?.along.x ?? 0) * Math.cos(Math.PI / 6) + (band?.along.y ?? 0) * Math.sin(Math.PI / 6))).toBeCloseTo(1, 6);
  });

  it('draws one zigzag whose legs touch both faces of the layer', () => {
    const legs = insulationZigzag(strip(0, 2, 0.2));
    expect(legs).toHaveLength(20);
    for (const [i, leg] of legs.entries()) {
      expect([leg.start.y, leg.end.y]).toEqual(i % 2 === 0 ? [0, 0.2] : [0.2, 0]);
      expect(leg.end.x - leg.start.x).toBeCloseTo(0.1, 9);
    }
  });

  it('follows a layer standing upright', () => {
    const legs = insulationZigzag(strip(90, 3, 0.1));
    expect(legs.every((leg) => Math.abs(Math.abs(leg.end.x - leg.start.x) - 0.1) < 1e-9)).toBe(true);
    expect(Math.max(...legs.map((leg) => Math.max(leg.start.y, leg.end.y)))).toBeCloseTo(3, 9);
  });

  it('returns nothing for a degenerate ring', () => {
    expect(insulationZigzag([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }])).toEqual([]);
  });

  it('is what the hatch generator draws for the insulation pattern, clipped to the polygon', () => {
    const { type, spacing, angle } = MATERIAL_HATCH_PATTERNS.insulation;
    const result = new HatchGenerator().generateHatch(insulation(strip(0, 2, 0.2)), 100, { type, spacing, angle });
    expect(result.lines).toHaveLength(20);
    expect(result.lines.every((l) => l.line.start.y >= -1e-9 && l.line.start.y <= 0.2 + 1e-9)).toBe(true);
  });

  it('exports the zigzag as lines and no tiled pattern', () => {
    const polygon = insulation(strip(0, 2, 0.2));
    const drawing: Drawing2D = {
      config: { ...DEFAULT_SECTION_CONFIG, plane: { axis: 'z', position: 0, flipped: false }, scale: 100 },
      lines: [],
      cutPolygons: [polygon],
      projectionPolygons: [],
      bounds: { min: { x: 0, y: 0 }, max: { x: 2, y: 0.2 } },
      stats: { cutLineCount: 0, projectionLineCount: 0, hiddenLineCount: 0, silhouetteLineCount: 0, polygonCount: 1, totalTriangles: 0, processingTimeMs: 0 },
    };
    const svg = exportToSVG(drawing, { materialCategories: new Map([[7, 'insulation']]) });
    expect(svg).not.toContain('url(#hatch-insulation)');
    expect(svg).toContain('data-hatch="insulation"');
    expect(svg.match(/<line /g)?.length ?? 0).toBeGreaterThanOrEqual(20);
  });
});
