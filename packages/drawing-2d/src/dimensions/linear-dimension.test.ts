/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import {
  dimensionDirection,
  dimensionText,
  linearDimensionGraphics,
  linearDimensionLength,
  type DimensionPt,
  type LinearDimension,
} from './linear-dimension.js';

const dim = (patch: Partial<LinearDimension> = {}): LinearDimension => ({
  a: { x: 0, y: 0 }, b: { x: 4, y: 0 }, offset: 0.5, orientation: 'aligned', ...patch,
});
const plain = (m: number) => m.toFixed(3);
const wholeMm = (m: number) => String(Math.round(m * 1000) + 0);
const close = (p: DimensionPt, q: DimensionPt, label: string) => {
  expect(Math.abs(p.x - q.x) < 1e-9 && Math.abs(p.y - q.y) < 1e-9, `${label}: got (${p.x}, ${p.y}), want (${q.x}, ${q.y})`).toBe(true);
};
const near = (p: number, q: number, label: string) => expect(Math.abs(p - q) < 1e-9, `${label}: got ${p}, want ${q}`).toBe(true);

describe('linearDimensionGraphics', () => {
  it('lays out an aligned dimension at 1:100 in paper millimetres', () => {
    const g = linearDimensionGraphics(dim(), { paperScale: 100, format: plain });
    close(g.lines[0][0], { x: 0, y: 0.5 }, 'dimension line start');
    close(g.lines[0][1], { x: 4, y: 0.5 }, 'dimension line end');
    expect(g.lines.length, 'dimension line plus two extension lines').toBe(3);
    close(g.lines[1][0], { x: 0, y: 0.1 }, 'extension starts 1 mm off the point');
    close(g.lines[1][1], { x: 0, y: 0.7 }, 'extension overshoots by 2 mm');
    expect(g.ticks.length).toBe(2);
    const [t0, t1] = g.ticks[0];
    near(Math.hypot(t1.x - t0.x, t1.y - t0.y), 0.25, 'tick is 2.5 mm long');
    near(Math.abs(t1.x - t0.x), Math.abs(t1.y - t0.y), 'tick runs at 45°');
    close({ x: (t0.x + t1.x) / 2, y: (t0.y + t1.y) / 2 }, { x: 0, y: 0.5 }, 'tick centred on the line end');
    near(g.text.heightM, 0.25, 'text is 2.5 mm high');
    close(g.text.at, { x: 2, y: 0.5 - 0.1 - 0.125 }, 'text centre sits 1 mm above the line on y-down paper');
    near(g.text.angle, 0, 'drawing angle');
    near(g.text.paperAngle, 0, 'paper angle');
    expect(g.text.value).toBe('4.000');
    near(g.measured, 4, 'measured');
  });

  it('scales sizes with the paper scale, not the measured geometry', () => {
    const g = linearDimensionGraphics(dim(), { paperScale: 50, format: plain });
    near(g.text.heightM, 0.125, 'text at 1:50');
    close(g.lines[1][1], { x: 0, y: 0.6 }, 'overshoot at 1:50');
    close(g.lines[0][0], { x: 0, y: 0.5 }, 'line position is the stored offset at any scale');
  });

  it('a horizontal dimension of a diagonal measures the x run; a point on the line gets no extension', () => {
    const g = linearDimensionGraphics(dim({ b: { x: 3, y: 2 }, offset: 1, orientation: 'horizontal' }), { paperScale: 100, format: plain });
    near(g.measured, 3, 'x run');
    close(g.lines[0][0], { x: 0, y: 2 }, 'line start');
    close(g.lines[0][1], { x: 3, y: 2 }, 'line end');
    expect(g.lines.length, 'b lies on the dimension line, so only a has an extension').toBe(2);
  });

  it('turns vertical text to read bottom to top', () => {
    const g = linearDimensionGraphics(dim({ b: { x: 0, y: 3 }, offset: 1 }), { paperScale: 100, format: plain });
    near(g.text.paperAngle, -Math.PI / 2, 'paper angle');
    near(g.measured, 3, 'measured');
    const reversed = linearDimensionGraphics(dim({ a: { x: 0, y: 3 }, b: { x: 0, y: 0 }, offset: -1 }), { paperScale: 100, format: plain });
    near(reversed.text.paperAngle, -Math.PI / 2, 'reversed paper angle');
  });

  it('keeps text upright after a section flip', () => {
    const flipped = linearDimensionGraphics(dim(), { paperScale: 100, format: plain, flip: { flipX: true, flipY: false } });
    near(flipped.text.paperAngle, 0, 'upright on paper');
    near(Math.abs(flipped.text.angle), Math.PI, 'reversed in drawing space, which the flip mirrors back');
    const both = linearDimensionGraphics(dim(), { paperScale: 100, format: plain, flip: { flipX: true, flipY: true } });
    near(both.text.paperAngle, 0, 'upright with both axes flipped');
    expect(both.text.at.y > 0.5, `text above the line on flipped paper, got y=${both.text.at.y}`).toBe(true);
  });

  it('a zero offset puts the line through the points, without extension lines', () => {
    const g = linearDimensionGraphics(dim({ offset: 0 }), { paperScale: 100, format: plain });
    expect(g.lines.length).toBe(1);
    close(g.lines[0][0], { x: 0, y: 0 }, 'line start');
  });

  it('measures along a unit-vector orientation at 30°', () => {
    const dir = { x: Math.cos(Math.PI / 6), y: Math.sin(Math.PI / 6) };
    const g = linearDimensionGraphics(dim({ orientation: dir, offset: 1 }), { paperScale: 100, format: plain });
    near(g.measured, 4 * dir.x, 'projection of a→b onto the direction');
    near(linearDimensionLength(dim({ orientation: dir })), 4 * dir.x, 'linearDimensionLength agrees');
    close(dimensionDirection(dim({ orientation: { x: 2 * dir.x, y: 2 * dir.y } })), dir, 'direction is normalised');
    const [pa, pb] = g.lines[0];
    near((pb.x - pa.x) * -dir.y + (pb.y - pa.y) * dir.x, 0, 'dimension line runs along the direction');
    near(Math.hypot(pb.x - pa.x, pb.y - pa.y), g.measured, 'line length is the measured value');
    const n = { x: -dir.y, y: dir.x };
    const mid = { x: (pa.x + pb.x) / 2 - 2, y: (pa.y + pb.y) / 2 };
    near(mid.x * n.x + mid.y * n.y, 1, 'line midpoint sits the offset along the left normal');
    near(g.text.paperAngle, Math.PI / 6, 'text follows the direction on y-down paper');
  });

  it('moves the text by textShift and nothing else', () => {
    const base = linearDimensionGraphics(dim(), { paperScale: 100, format: plain });
    const shifted = linearDimensionGraphics(dim({ textShift: { x: 0.3, y: -0.2 } }), { paperScale: 100, format: plain });
    close(shifted.text.at, { x: base.text.at.x + 0.3, y: base.text.at.y - 0.2 }, 'shifted text centre');
    expect(shifted.lines).toEqual(base.lines);
    expect(shifted.ticks).toEqual(base.ticks);
    near(shifted.text.angle, base.text.angle, 'angle unchanged');
  });
});

describe('linearDimensionLength', () => {
  it('projects a→b onto the orientation', () => {
    const d = { a: { x: 0, y: 0 }, b: { x: 3, y: -4 } };
    expect(linearDimensionLength({ ...d, orientation: 'aligned' })).toBe(5);
    expect(linearDimensionLength({ ...d, orientation: 'horizontal' })).toBe(3);
    expect(linearDimensionLength({ ...d, orientation: 'vertical' })).toBe(4);
  });
});

describe('dimensionText', () => {
  it('applies a text override around the measured value', () => {
    const g = linearDimensionGraphics(dim({ text: '<> clear' }), { paperScale: 100, format: wholeMm });
    expect(g.text.value).toBe('4000 clear');
    expect(dimensionText('<> (<>)', '12')).toBe('12 (12)');
    expect(dimensionText('TYP.', '12'), 'an override without <> replaces the value').toBe('TYP.');
    expect(dimensionText(undefined, '12')).toBe('12');
  });
});
