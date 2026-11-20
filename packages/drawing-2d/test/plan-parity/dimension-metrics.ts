/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** Dimension-chain metrics of one storey plan, measured from the drawing's own geometry. */

import type { Drawing2D, Point2D } from '../../src/types.js';
import { dimensionTextWidthMm, isPlanFabric, isPlanObstacle, linearDimensionGraphics, linearDimensionLength, type PlanDimensionChain } from '../../src/index.js';

export interface DimensionMetrics {
  sidesDimensioned: number;
  chainsClosing: number;
  openingChains: number;
  exteriorOpenings: number;
  exteriorOpeningsDimensioned: number;
  worstJambErrorMm: number;
  undimensionedOpenings: string[];
  spacesLabelled: number;
  spacesCrossedBothWays: number;
  interiorObstacleCrossings: number;
  interiorTextsOnObstacles: number;
}

const JAMB_TOLERANCE = 0.05;
const FACADE_DEPTH = 1;
const dot = (p: Point2D, q: Point2D) => p.x * q.x + p.y * q.y;

type Segment = readonly [Point2D, Point2D];

const ringSegments = (ring: readonly Point2D[]): Segment[] => ring.map((p, i) => [p, ring[(i + 1) % ring.length]]);

function rayHits(segments: readonly Segment[], from: Point2D, dir: Point2D): boolean {
  for (const [p, q] of segments) {
    const e = { x: q.x - p.x, y: q.y - p.y };
    const denom = dir.x * e.y - dir.y * e.x;
    if (Math.abs(denom) < 1e-12) continue;
    const w = { x: p.x - from.x, y: p.y - from.y };
    const t = (w.x * e.y - w.y * e.x) / denom;
    const u = (w.x * dir.y - w.y * dir.x) / denom;
    if (t > 0.05 && u >= 0 && u <= 1) return true;
  }
  return false;
}

function crosses([p, q]: Segment, [r, s]: Segment): boolean {
  const d1 = { x: q.x - p.x, y: q.y - p.y };
  const d2 = { x: s.x - r.x, y: s.y - r.y };
  const denom = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(denom) < 1e-12) return false;
  const w = { x: r.x - p.x, y: r.y - p.y };
  const t = (w.x * d2.y - w.y * d2.x) / denom;
  const u = (w.x * d1.y - w.y * d1.x) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

function dimensionLine(chain: PlanDimensionChain, segment: PlanDimensionChain['segments'][number]): Segment {
  const n = { x: -chain.direction.y, y: chain.direction.x };
  const mid = { x: (segment.a.x + segment.b.x) / 2, y: (segment.a.y + segment.b.y) / 2 };
  const c = segment.offset + dot(mid, n);
  const onto = (p: Point2D): Point2D => ({ x: p.x + n.x * (c - dot(p, n)), y: p.y + n.y * (c - dot(p, n)) });
  return [onto(segment.a), onto(segment.b)];
}

function segmentInBox([p, q]: Segment, half: Point2D): boolean {
  let t0 = 0;
  let t1 = 1;
  const d = { x: q.x - p.x, y: q.y - p.y };
  for (const [step, room] of [[-d.x, p.x + half.x], [d.x, half.x - p.x], [-d.y, p.y + half.y], [d.y, half.y - p.y]]) {
    if (Math.abs(step) < 1e-12) {
      if (room < 0) return false;
      continue;
    }
    const t = room / step;
    if (step < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}

function textOnObstacle(chain: PlanDimensionChain, segment: PlanDimensionChain['segments'][number], scale: number, obstacles: readonly Segment[]): boolean {
  const { text } = linearDimensionGraphics(segment, { paperScale: scale, format: (m) => String(Math.round(m * 1000)) });
  const along = chain.direction;
  const across = { x: -along.y, y: along.x };
  const local = (p: Point2D): Point2D => ({ x: dot({ x: p.x - text.at.x, y: p.y - text.at.y }, along), y: dot({ x: p.x - text.at.x, y: p.y - text.at.y }, across) });
  const half = { x: (dimensionTextWidthMm(text.value) * scale) / 2000, y: text.heightM / 2 };
  return obstacles.some(([p, q]) => segmentInBox([local(p), local(q)], half));
}

function stations(chain: PlanDimensionChain): number[] {
  return chain.segments.flatMap((s) => [dot(s.a, chain.direction), dot(s.b, chain.direction)]);
}

export function measureDimensions(drawing: Drawing2D, storeyElements: ReadonlySet<number>): DimensionMetrics {
  const chains = drawing.planDimensions ?? [];
  const exterior = chains.filter((c) => c.side !== undefined);
  const overall = new Map(exterior.filter((c) => c.kind === 'overall').map((c) => [c.side, c]));
  const openingChains = exterior.filter((c) => c.kind === 'openings');
  const total = (c: PlanDimensionChain) => c.segments.reduce((sum, s) => sum + linearDimensionLength(s), 0);
  const chainsClosing = openingChains.filter((c) => {
    const o = overall.get(c.side);
    return o !== undefined && Math.abs(total(c) - total(o)) < 1e-6;
  }).length;

  const fabric = drawing.cutPolygons.filter(isPlanFabric).flatMap((p) => ringSegments(p.polygon.outer));
  const rooms: Segment[] = (drawing.planSymbols ?? []).filter((s) => s.kind === 'space').flatMap((s) => s.lines.map((l): Segment => [l.start, l.end]));
  const leaves = (from: Point2D, dir: Point2D) => !rayHits(fabric, from, dir) && !rayHits(rooms, from, dir);
  const frameU = exterior[0]?.direction ?? { x: 1, y: 0 };
  const axes = [frameU, { x: -frameU.y, y: frameU.x }];
  let exteriorOpenings = 0;
  let dimensioned = 0;
  let worst = 0;
  const missing: string[] = [];
  for (const symbol of drawing.planSymbols ?? []) {
    if ((symbol.kind !== 'door' && symbol.kind !== 'window') || !storeyElements.has(symbol.entityId)) continue;
    const points = symbol.lines.flatMap((l) => [l.start, l.end]);
    if (points.length === 0) continue;
    const centre = { x: points.reduce((s, p) => s + p.x, 0) / points.length, y: points.reduce((s, p) => s + p.y, 0) / points.length };
    const facade = axes.find((along) => {
      const across = { x: -along.y, y: along.x };
      const side = [across, { x: -across.x, y: -across.y }].find((dir) => leaves(centre, dir));
      if (!side || !rayHits(fabric, centre, along) || !rayHits(fabric, centre, { x: -along.x, y: -along.y })) return false;
      const span = points.map((p) => dot(p, along));
      const lo = Math.min(...span) - 1;
      const hi = Math.max(...span) + 1;
      const near = fabric.flatMap((seg) => [...seg]).filter((p) => dot(p, along) >= lo && dot(p, along) <= hi);
      const outermost = Math.max(...near.map((p) => dot(p, side)));
      return outermost - dot(centre, side) <= FACADE_DEPTH;
    });
    if (!facade) continue;
    exteriorOpenings++;
    const span = points.map((p) => dot(p, facade));
    const jambs = [Math.min(...span), Math.max(...span)];
    const candidates = openingChains.filter((c) => Math.abs(Math.abs(dot(c.direction, facade)) - 1) < 1e-6);
    let best = Infinity;
    for (const chain of candidates) {
      const sign = dot(chain.direction, facade) > 0 ? 1 : -1;
      const marks = stations(chain).map((s) => s * sign);
      const error = Math.max(...jambs.map((j) => Math.min(...marks.map((m) => Math.abs(m - j)))));
      best = Math.min(best, error);
    }
    if (best <= JAMB_TOLERANCE) {
      dimensioned++;
      worst = Math.max(worst, best);
    } else {
      missing.push(`${symbol.entityId}:${symbol.kind}:${Number.isFinite(best) ? Math.round(best * 1000) : 'no chain'}`);
    }
  }

  const interior = chains.filter((c) => c.kind === 'interior');
  const spaceLabels = (drawing.planLabels ?? []).filter((l) => l.kind === 'space');
  const crossed = spaceLabels.filter((label) => {
    const outline = (drawing.planSymbols ?? []).filter((s) => s.kind === 'space' && s.entityId === label.entityId).flatMap((s) => s.lines.flatMap((l) => [l.start, l.end]));
    if (outline.length === 0) return false;
    return axes.every((along) => {
      const across = { x: -along.y, y: along.x };
      const acrossSpan = outline.map((p) => dot(p, across));
      return interior.some((chain) => {
        if (Math.abs(Math.abs(dot(chain.direction, along)) - 1) > 1e-6) return false;
        const level = dot(chain.segments[0].a, across);
        const marks = stations(chain).map((s) => s * (dot(chain.direction, along) > 0 ? 1 : -1));
        const at = dot(label.position, along);
        return level > Math.min(...acrossSpan) && level < Math.max(...acrossSpan) && Math.min(...marks) < at && Math.max(...marks) > at;
      });
    });
  }).length;

  const obstacles: Segment[] = [
    ...drawing.lines.filter((l) => isPlanObstacle(l.ifcType)).map((l): Segment => [l.line.start, l.line.end]),
    ...drawing.cutPolygons.filter((p) => isPlanObstacle(p.ifcType)).flatMap((p) => ringSegments(p.polygon.outer)),
  ];
  const interiorObstacleCrossings = interior.flatMap((chain) => chain.segments.map((s) => dimensionLine(chain, s))).filter((line) => obstacles.some((o) => crosses(line, o))).length;
  const interiorTextsOnObstacles = interior.flatMap((chain) => chain.segments.filter((s) => textOnObstacle(chain, s, drawing.config.scale, obstacles))).length;

  return {
    sidesDimensioned: overall.size,
    chainsClosing,
    openingChains: openingChains.length,
    exteriorOpenings,
    exteriorOpeningsDimensioned: dimensioned,
    worstJambErrorMm: Math.round(worst * 1000),
    undimensionedOpenings: missing,
    spacesLabelled: spaceLabels.length,
    spacesCrossedBothWays: crossed,
    interiorObstacleCrossings,
    interiorTextsOnObstacles,
  };
}
