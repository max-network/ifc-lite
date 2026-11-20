/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect } from 'vitest';
import type { DrawingPolygon, Point2D } from '../../types.js';
import type { PlanLabel } from '../plan-types.js';
import { createSectionConfig } from '../../drawing-generator.js';
import { linearDimensionLength, dimensionTextWidthMm, DIMENSION_PAPER_MM } from '../../dimensions/linear-dimension.js';
import { buildPlanDimensions, planDimensionGraphics } from './chains.js';
import type { PlanDimensionChain, PlanDimensionOptions } from './types.js';

let nextId = 1;
const rotate = (angle: number) => (p: Point2D): Point2D => ({
  x: p.x * Math.cos(angle) - p.y * Math.sin(angle),
  y: p.x * Math.sin(angle) + p.y * Math.cos(angle),
});

function rect(x0: number, y0: number, x1: number, y1: number, turn = 0, ifcType = 'IfcWall'): DrawingPolygon {
  const outer = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }].map(rotate(turn));
  return { polygon: { outer, holes: [] }, entityId: nextId++, ifcType, modelIndex: 0, isCut: true };
}

function label(x: number, y: number, text = 'Room', turn = 0): PlanLabel {
  return { kind: 'space', entityId: nextId++, modelIndex: 0, text, position: rotate(turn)({ x, y }) };
}

function plan(cutPolygons: DrawingPolygon[], planLabels: PlanLabel[] = [], options: PlanDimensionOptions = {}): PlanDimensionChain[] {
  return buildPlanDimensions({ cutPolygons, planLabels, config: createSectionConfig('y', 0, { scale: 100 }) }, options);
}

const lengths = (chain: PlanDimensionChain | undefined) => (chain?.segments ?? []).map((s) => Number(linearDimensionLength(s).toFixed(4)));
const chainOf = (chains: PlanDimensionChain[], kind: string, side?: string) => chains.find((c) => c.kind === kind && c.side === side);

/** 10 x 8 m, 0.3 m walls, a 1.2 m window in the top wall at x 3..4.2. */
function house(turn = 0): DrawingPolygon[] {
  return [
    rect(0, 0, 3, 0.3, turn),
    rect(4.2, 0, 10, 0.3, turn),
    rect(0, 7.7, 10, 8, turn),
    rect(0, 0.3, 0.3, 7.7, turn),
    rect(9.7, 0.3, 10, 7.7, turn),
  ];
}

describe('buildPlanDimensions: facade chains', () => {
  it('chains the window jambs of a facade and closes them to the overall length', () => {
    const chains = plan(house(), [], { kinds: ['openings', 'overall'] });
    expect(lengths(chainOf(chains, 'openings', 'top'))).toEqual([3, 1.2, 5.8]);
    expect(lengths(chainOf(chains, 'overall', 'top'))).toEqual([10]);
    expect(chainOf(chains, 'openings', 'bottom')).toBeUndefined();
    expect(lengths(chainOf(chains, 'overall', 'bottom'))).toEqual([10]);
    expect(lengths(chainOf(chains, 'overall', 'left'))).toEqual([8]);
    expect(lengths(chainOf(chains, 'overall', 'right'))).toEqual([8]);
  });

  it('anchors on the outer face and stacks the tiers outward in paper millimetres', () => {
    const chains = plan(house(), [], { kinds: ['openings', 'overall'] });
    const graphics = (chain: PlanDimensionChain | undefined) => planDimensionGraphics(chain ? [chain] : [], { paperScale: 100 });
    const openings = graphics(chainOf(chains, 'openings', 'top'));
    const overall = graphics(chainOf(chains, 'overall', 'top'));
    for (const g of openings) expect(g.lines[0][0].y).toBeCloseTo(-1.0, 9);
    for (const g of overall) expect(g.lines[0][0].y).toBeCloseTo(-1.8, 9);
    expect(openings[0].lines[1][0]).toEqual({ x: 0, y: -0.1 });
  });

  it('keeps a recess as a recess and dimensions the window in its back wall', () => {
    const walls = [
      rect(0, 0, 4.3, 0.3),
      rect(4.0, 0.3, 4.3, 1.8),
      rect(4.0, 1.5, 4.6, 1.8),
      rect(5.4, 1.5, 6.0, 1.8),
      rect(5.7, 0.3, 6.0, 1.8),
      rect(5.7, 0, 10, 0.3),
      rect(0, 7.7, 10, 8),
      rect(0, 0.3, 0.3, 7.7),
      rect(9.7, 0.3, 10, 7.7),
    ];
    const chains = plan(walls, [], { kinds: ['openings', 'overall'] });
    expect(lengths(chainOf(chains, 'openings', 'top'))).toEqual([4.3, 0.3, 0.8, 0.3, 4.3]);
    expect(lengths(chainOf(chains, 'overall', 'top'))).toEqual([10]);
    const shallow = plan(walls, [], { kinds: ['openings'], maxWallThickness: 2 });
    expect(lengths(chainOf(shallow, 'openings', 'top'))).toEqual([4.3, 1.4, 4.3]);
  });

  it('follows a building turned off the drawing axes', () => {
    const turn = Math.PI / 6;
    const chains = plan(house(turn), [], { kinds: ['openings', 'overall'] });
    const openings = chains.find((c) => c.kind === 'openings');
    expect(lengths(openings)).toEqual([3, 1.2, 5.8]);
    const dir = openings?.direction ?? { x: 0, y: 0 };
    expect(Math.abs(dir.x * Math.cos(turn) + dir.y * Math.sin(turn))).toBeCloseTo(1, 9);
  });

  it('reads a layered wall as one wall', () => {
    const walls = [
      rect(0, 0, 3, 0.1), rect(0, 0.1, 3, 0.3),
      rect(4.2, 0, 10, 0.1), rect(4.2, 0.1, 10, 0.3),
      rect(0, 7.7, 10, 8), rect(0, 0.3, 0.3, 7.7), rect(9.7, 0.3, 10, 7.7),
    ];
    const chains = plan(walls, [label(6, 4)], { kinds: ['openings', 'interior'] });
    expect(lengths(chainOf(chains, 'openings', 'top'))).toEqual([3, 1.2, 5.8]);
    const vertical = chains.filter((c) => c.kind === 'interior' && Math.abs(c.direction.y) > 0.5);
    expect(lengths(vertical[0])).toEqual([7.4]);
  });

  it('adds a grid chain between the openings and the overall chain', () => {
    const grids = [
      { tag: 'A', start: { x: 0.15, y: -3 }, end: { x: 0.15, y: 11 } },
      { tag: 'B', start: { x: 9.85, y: -3 }, end: { x: 9.85, y: 11 } },
    ];
    const chains = plan(house(), [], { grids, kinds: ['openings', 'grid', 'overall'] });
    const grid = chainOf(chains, 'grid', 'top');
    expect(lengths(grid)).toEqual([9.7]);
    const lineY = (chain: PlanDimensionChain | undefined) => planDimensionGraphics(chain ? [chain] : [], { paperScale: 100 })[0].lines[0][0].y;
    expect(lineY(chainOf(chains, 'openings', 'top'))).toBeCloseTo(-1.0, 9);
    expect(lineY(grid)).toBeCloseTo(-1.8, 9);
    expect(lineY(chainOf(chains, 'overall', 'top'))).toBeCloseTo(-2.6, 9);
  });

  it('splits a glazing band at the jambs of the windows filling it', () => {
    const walls = [rect(0, 0, 2, 0.3), rect(6, 0, 10, 0.3), rect(0, 7.7, 10, 8), rect(0, 0.3, 0.3, 7.7), rect(9.7, 0.3, 10, 7.7)];
    const window = (x0: number, x1: number) => ({
      kind: 'window' as const, entityId: nextId++, ifcType: 'IfcWindow', modelIndex: 0,
      lines: [{ start: { x: x0, y: 0.1 }, end: { x: x1, y: 0.1 } }, { start: { x: x0, y: 0.2 }, end: { x: x1, y: 0.2 } }],
    });
    const chains = buildPlanDimensions({
      cutPolygons: walls, planLabels: [], planSymbols: [window(2, 4), window(4, 6)], config: createSectionConfig('y', 0, { scale: 100 }),
    }, { kinds: ['openings'] });
    expect(lengths(chainOf(chains, 'openings', 'top'))).toEqual([2, 2, 2, 4]);
  });

  it('builds nothing without fabric', () => {
    expect(plan([rect(0, 0, 1, 1, 0, 'IfcSlab')])).toEqual([]);
  });
});

describe('buildPlanDimensions: interior chains', () => {
  it('measures each room once per direction and each interior wall once', () => {
    const walls = [...house(), rect(4.9, 0.3, 5.1, 7.7)];
    const chains = plan(walls, [label(2.5, 4, 'Living'), label(7.5, 4, 'Kitchen')], { kinds: ['interior'] });
    const horizontal = chains.filter((c) => Math.abs(c.direction.x) > 0.5);
    expect(horizontal.map(lengths)).toEqual([[4.6, 0.2], [4.6]]);
    const vertical = chains.filter((c) => Math.abs(c.direction.y) > 0.5);
    expect(vertical.map(lengths)).toEqual([[7.4], [7.4]]);
  });

  it('dimensions the whole width when the plan has no rooms', () => {
    const walls = [...house(), rect(4.9, 0.3, 5.1, 7.7)];
    const horizontal = plan(walls, [], { kinds: ['interior'] }).filter((c) => Math.abs(c.direction.x) > 0.5);
    expect(horizontal.map(lengths)).toEqual([[0.3, 4.6, 0.2, 4.6, 0.3]]);
  });

  it('moves a room chain off a stair to the other side of the label', () => {
    const stair = rect(5, 2.5, 6, 3.6, 0, 'IfcStair');
    const levels = (options: PlanDimensionOptions) => {
      const chains = plan([...house(), stair], [label(6.5, 4, 'Living')], { kinds: ['interior'], ...options });
      const across = chains.find((c) => Math.abs(c.direction.x) > 0.5);
      const beside = chains.find((c) => Math.abs(c.direction.y) > 0.5);
      return { across: across?.segments[0].a.y, beside: beside?.segments[0].a.x, spans: [lengths(across), lengths(beside)] };
    };
    const clear = levels({});
    expect(clear.across).toBeCloseTo(5.05);
    expect(clear.beside).toBeCloseTo(8);
    expect(clear.spans).toEqual([[9.4], [7.4]]);
    const ignored = levels({ obstacle: () => false });
    expect(ignored.across).toBeCloseTo(3.4);
    expect(ignored.beside).toBeCloseTo(5.45);
  });
});

describe('buildPlanDimensions: text placement', () => {
  it('keeps the texts of narrow segments apart', () => {
    const piers = [rect(0, 0, 0.24, 0.3), rect(1.25, 0, 1.49, 0.3), rect(2.5, 0, 2.74, 0.3), rect(3.75, 0, 10, 0.3)];
    const walls = [...piers, rect(0, 7.7, 10, 8), rect(0, 0.3, 0.3, 7.7), rect(9.7, 0.3, 10, 7.7)];
    const chain = chainOf(plan(walls, [], { kinds: ['openings'] }), 'openings', 'top');
    const graphics = planDimensionGraphics(chain ? [chain] : [], { paperScale: 100 });
    const boxes = graphics.map((g) => ({ x: g.text.at.x, y: g.text.at.y, w: (dimensionTextWidthMm(g.text.value) * 100) / 1000, h: (DIMENSION_PAPER_MM.textHeight * 100) / 1000 }));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const apart = Math.abs(a.x - b.x) >= (a.w + b.w) / 2 || Math.abs(a.y - b.y) >= (a.h + b.h) / 2;
        expect(apart, `${graphics[i].text.value} / ${graphics[j].text.value}`).toBe(true);
      }
    }
  });
});
