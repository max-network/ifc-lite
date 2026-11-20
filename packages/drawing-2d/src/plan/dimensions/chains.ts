/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { Drawing2D, DrawingPolygon, Point2D } from '../../types.js';
import {
  DIMENSION_PAPER_MM,
  dimensionTextWidthMm,
  linearDimensionGraphics,
  type DimensionGraphics,
  type LinearDimension,
} from '../../dimensions/linear-dimension.js';
import { principalFrame, sideFrame, type PlanFrame } from './frame.js';
import { facadeRuns, facadeStations, type FacadeFilling, type FacadeStation } from './facade.js';
import { outlineSpan, roomSpan, roomStations, scanIntervals, type LocalPolygon, type LocalSegment, type ScanAxis } from './interior.js';
import { chainCrossings, isPlanObstacle, obstacleSegments } from './obstacles.js';
import type { PlanDimensionChain, PlanDimensionKind, PlanDimensionOptions, PlanDimensionSide, PlanGridAxis } from './types.js';

const SIDES: readonly PlanDimensionSide[] = ['top', 'right', 'bottom', 'left'];
const KINDS: readonly PlanDimensionKind[] = ['openings', 'grid', 'overall', 'interior'];
const FABRIC = /^Ifc(Wall|Column|CurtainWall)/i;
const PARALLEL = Math.sin(Math.PI / 90);
const LABEL_CLEARANCE_MM = 6;
const LABEL_CHAR_MM = 1.5;

export const isPlanFabric = (polygon: DrawingPolygon): boolean => FABRIC.test(polygon.ifcType) && !/type$/i.test(polygon.ifcType);

/** Whole millimetres without a unit, the ISO 129 default for building drawings. */
export const formatMillimetres = (metres: number): string => String(Math.round(metres * 1000) + 0);

interface ChainContext {
  frame: PlanFrame;
  scale: number;
  format: (metres: number) => string;
}

function uprightUp(direction: Point2D): Point2D {
  const along = direction.x < -1e-9 || (Math.abs(direction.x) <= 1e-9 && direction.y > 0) ? { x: -direction.x, y: -direction.y } : direction;
  return { x: along.y, y: -along.x };
}

function chainSegments(anchors: readonly Point2D[], direction: Point2D, line: Point2D, ctx: ChainContext): LinearDimension[] {
  const n = { x: -direction.y, y: direction.x };
  const c = line.x * n.x + line.y * n.y;
  const m = (paperMm: number) => (paperMm * ctx.scale) / 1000;
  const up = uprightUp(direction);
  const drop = m(DIMENSION_PAPER_MM.textHeight + 2 * DIMENSION_PAPER_MM.textGap);
  const segments: LinearDimension[] = [];
  let narrowRun = 0;
  for (let k = 0; k + 1 < anchors.length; k++) {
    const a = anchors[k];
    const b = anchors[k + 1];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const length = Math.abs((b.x - a.x) * direction.x + (b.y - a.y) * direction.y);
    const segment: LinearDimension = { a, b, offset: c - (mid.x * n.x + mid.y * n.y), orientation: direction };
    const textMm = dimensionTextWidthMm(ctx.format(length));
    if ((length * 1000) / ctx.scale >= textMm + DIMENSION_PAPER_MM.textGap) {
      narrowRun = 0;
    } else {
      const clear = length / 2 + m(textMm / 2 + DIMENSION_PAPER_MM.textGap);
      const last = k + 2 === anchors.length;
      if (k === 0 && !last) segment.textShift = { x: -direction.x * clear, y: -direction.y * clear };
      else if (last && k > 0) segment.textShift = { x: direction.x * clear, y: direction.y * clear };
      else if (narrowRun % 2 === 0) segment.textShift = { x: -up.x * drop, y: -up.y * drop };
      narrowRun++;
    }
    segments.push(segment);
  }
  return segments;
}

function exteriorChains(rings: readonly (readonly Point2D[])[], fillings: readonly (readonly Point2D[])[], grids: readonly PlanGridAxis[], kinds: ReadonlySet<PlanDimensionKind>, sides: readonly PlanDimensionSide[], options: PlanDimensionOptions, ctx: ChainContext): PlanDimensionChain[] {
  const chains: PlanDimensionChain[] = [];
  const maxWall = options.maxWallThickness ?? 1;
  const first = options.firstOffsetMm ?? 10;
  const spacing = options.tierSpacingMm ?? 8;
  for (const side of sides) {
    const frame = sideFrame(side);
    const runs = facadeRuns(rings, frame, maxWall);
    if (runs.length === 0) continue;
    const outer = Math.min(...runs.map((r) => r.d));
    const direction = ctx.frame.toDrawing(frame.along);
    const toDrawing = (station: FacadeStation): Point2D => ctx.frame.toDrawing(frame.toLocal(station.s, station.d));
    const footprints = fillings.map((points): FacadeFilling => {
      const side = points.map(frame.toSide);
      return { s0: Math.min(...side.map((p) => p.s)), s1: Math.max(...side.map((p) => p.s)), d0: Math.min(...side.map((p) => p.d)), d1: Math.max(...side.map((p) => p.d)) };
    });
    const stations = facadeStations(runs, footprints, maxWall);
    const tiers: { kind: PlanDimensionKind; stations: FacadeStation[] }[] = [];
    if (kinds.has('openings') && stations.length > 2) tiers.push({ kind: 'openings', stations });
    if (kinds.has('grid')) {
      const axes = gridStations(grids, frame, ctx.frame, outer);
      if (axes.length >= 2) tiers.push({ kind: 'grid', stations: axes });
    }
    if (kinds.has('overall')) tiers.push({ kind: 'overall', stations: [stations[0], stations[stations.length - 1]] });
    tiers.forEach((tier, index) => {
      const depth = outer - ((first + index * spacing) * ctx.scale) / 1000;
      const line = toDrawing({ s: tier.stations[0].s, d: depth });
      chains.push({ kind: tier.kind, side, direction, segments: chainSegments(tier.stations.map(toDrawing), direction, line, ctx) });
    });
  }
  return chains;
}

function gridStations(grids: readonly PlanGridAxis[], frame: ReturnType<typeof sideFrame>, plan: PlanFrame, outer: number): FacadeStation[] {
  const stations: FacadeStation[] = [];
  for (const axis of grids) {
    const p = frame.toSide(plan.toLocal(axis.start));
    const q = frame.toSide(plan.toLocal(axis.end));
    const length = Math.hypot(q.s - p.s, q.d - p.d);
    if (length < 1e-6 || Math.abs(q.s - p.s) > PARALLEL * length) continue;
    const s = (p.s + q.s) / 2;
    if (!stations.some((st) => Math.abs(st.s - s) < 1e-3)) stations.push({ s, d: outer });
  }
  return stations.sort((a, b) => a.s - b.s);
}

interface RoomLabel {
  position: Point2D;
  text: string;
  outline: readonly LocalSegment[];
}

function interiorChains(polygons: readonly LocalPolygon[], labels: readonly RoomLabel[], obstacles: readonly LocalSegment[], ctx: ChainContext): PlanDimensionChain[] {
  const m = (paperMm: number) => (paperMm * ctx.scale) / 1000;
  const walls = new Set<string>();
  const chains: PlanDimensionChain[] = [];
  const add = (axis: ScanAxis, at: number, stations: readonly number[]) => {
    if (stations.length < 2) return;
    const local = (s: number): Point2D => (axis === 'u' ? { x: s, y: at } : { x: at, y: s });
    const anchors = stations.map((s) => ctx.frame.toDrawing(local(s)));
    const direction = axis === 'u' ? ctx.frame.u : ctx.frame.v;
    chains.push({ kind: 'interior', direction, segments: chainSegments(anchors, direction, anchors[0], ctx) });
  };
  const band = m(DIMENSION_PAPER_MM.textHeight + 2 * DIMENSION_PAPER_MM.textGap);
  const step = m(DIMENSION_PAPER_MM.textHeight);
  if (labels.length === 0) {
    const ys = polygons.flatMap((poly) => poly[0]?.map((p) => p.y) ?? []);
    const xs = polygons.flatMap((poly) => poly[0]?.map((p) => p.x) ?? []);
    if (xs.length === 0) return [];
    const through = (axis: ScanAxis, lo: number, hi: number) => {
      const mid = (lo + hi) / 2;
      const levels = [mid];
      for (let k = 1; k * step < (hi - lo) / 2; k++) levels.push(mid - k * step, mid + k * step);
      let best: { at: number; intervals: [number, number][]; hits: number } | undefined;
      for (const at of levels) {
        const intervals = scanIntervals(polygons, axis, at);
        if (intervals.length < 2) continue;
        const hits = chainCrossings(obstacles, axis, at, intervals[0][0], intervals[intervals.length - 1][1], band);
        if (!best || hits < best.hits) best = { at, intervals, hits };
        if (hits === 0) break;
      }
      if (best) add(axis, best.at, best.intervals.flat());
    };
    through('u', Math.min(...ys), Math.max(...ys));
    through('v', Math.min(...xs), Math.max(...xs));
    return chains;
  }
  const margin = m(DIMENSION_PAPER_MM.textHeight + 3 * DIMENSION_PAPER_MM.textGap);
  const inRoom = (wanted: number, span: [number, number] | undefined) =>
    span && span[1] - span[0] > 2 * margin ? Math.min(Math.max(wanted, span[0] + margin), span[1] - margin) : wanted;
  const place = (axis: ScanAxis, label: RoomLabel, from: number, inside: number, clearance: number): number => {
    const room = outlineSpan(label.outline, axis === 'u' ? 'v' : 'u', inside, from);
    const wanted = inRoom(from - clearance, room);
    if (obstacles.length === 0) return wanted;
    const reach = room ? room[1] - room[0] : 0;
    const candidates = [from - clearance, from + clearance];
    for (let k = 1; k * step < reach; k++) candidates.push(from - clearance - k * step, from + clearance + k * step);
    let best = { at: wanted, hits: Infinity };
    for (const candidate of candidates) {
      const at = inRoom(candidate, room);
      if (at !== wanted && Math.abs(at - from) < clearance - 1e-9) continue;
      const span = roomSpan(polygons, axis, at, inside, label.outline);
      if (!span) continue;
      const hits = chainCrossings(obstacles, axis, at, span[0], span[1], band);
      if (hits < best.hits) best = { at, hits };
      if (hits === 0) break;
    }
    return best.at;
  };
  for (const label of labels) {
    const p = ctx.frame.toLocal(label.position);
    const across = place('u', label, p.y, p.x, m(LABEL_CLEARANCE_MM));
    add('u', across, roomStations(polygons, 'u', across, p.x, walls, label.outline));
    const beside = place('v', label, p.x, p.y, m((label.text.length * LABEL_CHAR_MM) / 2 + LABEL_CLEARANCE_MM));
    add('v', beside, roomStations(polygons, 'v', beside, p.y, walls, label.outline));
  }
  return chains;
}

/** Dimension chains of a storey plan: per facade the openings, grid and overall chains, plus interior chains through the rooms. */
export function buildPlanDimensions(drawing: Pick<Drawing2D, 'cutPolygons' | 'planLabels' | 'config'> & Partial<Pick<Drawing2D, 'planSymbols' | 'lines'>>, options: PlanDimensionOptions = {}): PlanDimensionChain[] {
  const fabric = drawing.cutPolygons.filter(options.fabric ?? isPlanFabric).filter((p) => p.polygon.outer.length >= 3);
  if (fabric.length === 0) return [];
  const frame = principalFrame(fabric.map((p) => p.polygon.outer));
  const ctx: ChainContext = { frame, scale: drawing.config.scale, format: options.format ?? formatMillimetres };
  const kinds = new Set(options.kinds ?? KINDS);
  const local: LocalPolygon[] = fabric.map((p) => [p.polygon.outer, ...p.polygon.holes].map((ring) => ring.map(frame.toLocal)));
  const fillings = (drawing.planSymbols ?? [])
    .filter((symbol) => symbol.kind === 'door' || symbol.kind === 'window')
    .map((symbol) => symbol.lines.flatMap((line) => [frame.toLocal(line.start), frame.toLocal(line.end)]))
    .filter((points) => points.length > 0);
  const chains = exteriorChains(local.map((p) => p[0]), fillings, options.grids ?? [], kinds, options.sides ?? SIDES, options, ctx);
  if (kinds.has('interior')) {
    const outlines = new Map<number, LocalSegment[]>();
    for (const symbol of drawing.planSymbols ?? []) {
      if (symbol.kind !== 'space') continue;
      const list = outlines.get(symbol.entityId) ?? [];
      for (const line of symbol.lines) list.push([frame.toLocal(line.start), frame.toLocal(line.end)]);
      outlines.set(symbol.entityId, list);
    }
    const labels = (drawing.planLabels ?? []).filter((l) => l.kind === 'space').map((l) => ({ position: l.position, text: l.text, outline: outlines.get(l.entityId) ?? [] }));
    const obstacles = obstacleSegments(drawing, options.obstacle ?? isPlanObstacle, frame.toLocal);
    chains.push(...interiorChains(local, labels, obstacles, ctx));
  }
  return chains;
}

/** The drawable graphics of every chain segment. */
export function planDimensionGraphics(chains: readonly PlanDimensionChain[], options: { paperScale: number; format?: (metres: number) => string }): DimensionGraphics[] {
  const format = options.format ?? formatMillimetres;
  return chains.flatMap((chain) => chain.segments.map((segment) => linearDimensionGraphics(segment, { paperScale: options.paperScale, format })));
}
