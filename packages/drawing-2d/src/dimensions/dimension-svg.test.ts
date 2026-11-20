/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { boundsWithDimensions, dimensionsToSvg, placeDimensionText, type DimensionMapPoint } from './dimension-svg.js';
import { linearDimensionGraphics, type DimensionGraphicsOptions, type LinearDimension } from './linear-dimension.js';

const horizontal: LinearDimension = { a: { x: 1, y: 2 }, b: { x: 5, y: 2 }, offset: 0.5, orientation: 'aligned' };
const vertical: LinearDimension = { a: { x: 0, y: 0 }, b: { x: 0, y: 3 }, offset: -1, orientation: 'aligned' };

const format = (m: number) => String(Math.round(m * 1000) + 0);
const graphics = (dims: LinearDimension[], paperScale: number, flip?: DimensionGraphicsOptions['flip']) =>
  dims.map((d) => linearDimensionGraphics(d, { paperScale, format, flip }));
const identity: DimensionMapPoint = (x, y) => ({ x, y });

const close = (actual: number, expected: number, what: string) =>
  expect(Math.abs(actual - expected) < 1e-9, `${what}: ${actual} ≠ ${expected}`).toBe(true);

function parseSvg(svg: string) {
  const lines = [...svg.matchAll(/<line x1="([^"]+)" y1="([^"]+)" x2="([^"]+)" y2="([^"]+)" stroke-width="([^"]+)"\/>/g)]
    .map((m) => m.slice(1, 6).map(Number));
  const texts = [...svg.matchAll(/<text x="([^"]+)" y="([^"]+)" transform="rotate\(([^ ]+) [^)]+\)"[^>]*font-size="([^"]+)"[^>]*>([^<]*)<\/text>/g)]
    .map((m) => ({ x: Number(m[1]), y: Number(m[2]), angle: Number(m[3]), size: Number(m[4]), value: m[5] }));
  return { lines, texts };
}

describe('dimensionsToSvg', () => {
  it('writes the lines, 45° ticks and value of a plan dimension at 1:100 in drawing metres', () => {
    const { lines, texts } = parseSvg(dimensionsToSvg(graphics([horizontal], 100), identity, (mm) => mm / 10));
    const t = 0.125 * Math.SQRT1_2;
    const r = (v: number) => Number(v.toFixed(4));
    expect(lines.map((l) => l.map(r))).toEqual([
      [1, 2.5, 5, 2.5, 0.018],
      [1, 2.1, 1, 2.7, 0.018],
      [5, 2.1, 5, 2.7, 0.018],
      [r(1 - t), r(2.5 + t), r(1 + t), r(2.5 - t), 0.035],
      [r(5 - t), r(2.5 + t), r(5 + t), r(2.5 - t), 0.035],
    ]);
    expect(texts).toEqual([{ x: 3, y: 2.275, angle: 0, size: 0.25, value: '4000' }]);
  });

  it('keeps 2.5 mm text and 1 mm gaps on paper at 1:50 in sheet millimetres', () => {
    const sheetMap: DimensionMapPoint = (x, y) => ({ x: x * 20 + 10, y: y * 20 + 10 });
    const { lines, texts } = parseSvg(dimensionsToSvg(graphics([horizontal], 50), sheetMap, (mm) => mm));
    expect(lines[0]).toEqual([30, 60, 110, 60, 0.18]);
    expect(lines[1], 'gap 1 mm, overshoot 2 mm on paper').toEqual([30, 51, 30, 62, 0.18]);
    const tick = Math.hypot(lines[3][2] - lines[3][0], lines[3][3] - lines[3][1]);
    expect(Math.abs(tick - 2.5) < 1e-3, `tick length on paper (to the SVG's 4 decimals): ${tick}`).toBe(true);
    expect(texts).toEqual([{ x: 70, y: 57.75, angle: 0, size: 2.5, value: '4000' }]);
  });

  it('reads a vertical dimension bottom to top', () => {
    const { texts } = parseSvg(dimensionsToSvg(graphics([vertical], 100), identity, (mm) => mm / 10));
    expect(texts[0].angle).toBe(-90);
    expect(texts[0].value).toBe('3000');
  });

  it('escapes a text override and writes nothing without dimensions', () => {
    const svg = dimensionsToSvg(graphics([{ ...horizontal, text: 'a<b & "<>"' }], 100), identity, (mm) => mm);
    expect(svg).toMatch(/>a&lt;b &amp; &quot;4000&quot;<\/text>/);
    expect(dimensionsToSvg([], identity, (mm) => mm)).toBe('');
  });

  it('applies the DXF preflight rule: a zero-length dimension is left out', () => {
    const options = { paperScale: 100, format: (m: number) => `${m} m` };
    const valid = linearDimensionGraphics({ a: { x: 0, y: 0 }, b: { x: 5, y: 0 }, offset: 0, orientation: 'aligned' }, options);
    const zero = linearDimensionGraphics({ a: { x: 50, y: 50 }, b: { x: 50, y: 50 }, offset: 0, orientation: 'aligned' }, options);
    const svg = dimensionsToSvg([zero, valid], identity, (mm) => mm);
    expect((svg.match(/class="dimension"/g) ?? []).length).toBe(1);
    expect(svg).toMatch(/>5 m<\/text>/);
    expect(svg).not.toMatch(/>0 m<\/text>/);
    const bounds = { min: { x: -1, y: -1 }, max: { x: 10, y: 10 } };
    expect(boundsWithDimensions(bounds, [zero, valid])).toEqual(bounds);
  });
});

describe('placeDimensionText', () => {
  it('measures size and direction through the writer map', () => {
    const [g] = graphics([horizontal], 100, { flipX: true, flipY: true });
    const placed = placeDimensionText(g.text, (x, y) => ({ x: -x * 10, y: -y * 10 }));
    close(placed.angleDeg, 0, 'upright');
    close(placed.size, 2.5, 'size in page mm');
  });
});

describe('boundsWithDimensions', () => {
  it('grows the drawing extent to hold a dimension placed beyond the geometry, and keeps it otherwise', () => {
    const bounds = { min: { x: 0, y: 0 }, max: { x: 6, y: 3 } };
    const grown = boundsWithDimensions(bounds, graphics([{ ...horizontal, offset: 100 }], 100));
    expect(grown.max.y >= 102.2, `max y ${grown.max.y}`).toBe(true);
    expect([grown.min.x, grown.min.y, grown.max.x]).toEqual([0, 0, 6]);
    expect(boundsWithDimensions(bounds, [])).toBe(bounds);
    expect(boundsWithDimensions(bounds, graphics([horizontal], 100)), 'a dimension inside the extent changes nothing').toEqual(bounds);
  });
});
