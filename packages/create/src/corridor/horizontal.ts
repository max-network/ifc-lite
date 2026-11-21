/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { HorizontalSegment } from '../landxml/alignment-mapping.js';
import type { CorridorProblem } from './problems.js';

export type PlanXY = readonly [number, number];

export interface HorizontalFrame {
  x: number;
  y: number;
  /** Radians counter-clockwise from +X. */
  direction: number;
}

const ANGLE_EPS = 1e-9;
const LENGTH_EPS = 1e-9;
const U_TURN = Math.PI - 1e-6;

const wrap = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));

function lineSegment(sourceId: string, start: PlanXY, direction: number, length: number): HorizontalSegment {
  const end: PlanXY = [start[0] + Math.cos(direction) * length, start[1] + Math.sin(direction) * length];
  return { sourceId, type: 'LINE', start, direction, startRadius: 0, endRadius: 0, length, end, endDirection: direction, startCurvature: 0, endCurvature: 0 };
}

function arcSegment(sourceId: string, start: PlanXY, direction: number, radius: number, length: number): HorizontalSegment {
  const segment: HorizontalSegment = {
    sourceId, type: 'CIRCULARARC', start, direction, startRadius: radius, endRadius: radius, length,
    end: start, endDirection: direction + length / radius, startCurvature: 1 / radius, endCurvature: 1 / radius,
  };
  const end = frameOn(segment, length);
  return { ...segment, end: [end.x, end.y] };
}

function frameOn(segment: HorizontalSegment, t: number): HorizontalFrame {
  const [x0, y0] = segment.start;
  const theta0 = segment.direction;
  if (segment.type !== 'CIRCULARARC' || segment.startRadius === 0) {
    return { x: x0 + Math.cos(theta0) * t, y: y0 + Math.sin(theta0) * t, direction: theta0 };
  }
  const r = segment.startRadius;
  const theta = theta0 + t / r;
  const cx = x0 - r * Math.sin(theta0);
  const cy = y0 + r * Math.cos(theta0);
  return { x: cx + r * Math.sin(theta), y: cy - r * Math.cos(theta), direction: theta };
}

export function centrelineLength(segments: readonly HorizontalSegment[]): number {
  return segments.reduce((sum, segment) => sum + segment.length, 0);
}

/** Point and tangent direction at station `s`, clamped to the centreline. */
export function horizontalAt(segments: readonly HorizontalSegment[], s: number): HorizontalFrame {
  let start = 0;
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (s <= start + segment.length || i === segments.length - 1) return frameOn(segment, Math.min(Math.max(s - start, 0), segment.length));
    start += segment.length;
  }
  throw new Error('horizontalAt: the centreline has no segments');
}

/** The point `offset` metres left of the centreline (right when negative) at a frame. */
export function offsetFrom(frame: HorizontalFrame, offset: number): PlanXY {
  return [frame.x - Math.sin(frame.direction) * offset, frame.y + Math.cos(frame.direction) * offset];
}

interface Turn {
  delta: number;
  radius: number;
  tangent: number;
  given: boolean;
}

/**
 * Lines and tangent circular arcs through a polyline: at each interior vertex
 * an arc of the given radius, or of the largest radius whose tangents fit in
 * half of each shared leg. Stationed by arc length from the first point.
 */
export function centrelineSegments(
  points: readonly PlanXY[], radii: readonly (number | null | undefined)[], halfWidth: number,
): { segments: HorizontalSegment[]; problems: CorridorProblem[] } {
  const problems: CorridorProblem[] = [];
  if (points.length < 2) return { segments: [], problems: [{ code: 'centreline', values: { points: points.length } }] };
  const legs = points.slice(1).map((p, j) => {
    const q = points[j];
    return { length: Math.hypot(p[0] - q[0], p[1] - q[1]), direction: Math.atan2(p[1] - q[1], p[0] - q[0]) };
  });
  legs.forEach((leg, j) => {
    if (leg.length <= LENGTH_EPS) problems.push({ code: 'centreline', vertex: j + 1, values: { length: leg.length } });
  });
  if (problems.length > 0) return { segments: [], problems };

  const last = points.length - 2;
  const turns: Turn[] = points.map((_, i): Turn => {
    if (i === 0 || i > last) return { delta: 0, radius: 0, tangent: 0, given: false };
    const delta = wrap(legs[i].direction - legs[i - 1].direction);
    const half = Math.abs(delta) / 2;
    if (Math.abs(delta) < ANGLE_EPS) return { delta: 0, radius: 0, tangent: 0, given: false };
    const stated = radii[i - 1];
    const given = typeof stated === 'number';
    if (Math.abs(delta) >= U_TURN) return { delta, radius: given ? stated : 0, tangent: Infinity, given };
    const room = Math.min(i - 1 === 0 ? legs[i - 1].length : legs[i - 1].length / 2, i === last ? legs[i].length : legs[i].length / 2);
    const radius = given ? stated : room / Math.tan(half);
    return { delta, radius, tangent: radius * Math.tan(half), given };
  });

  turns.forEach((turn, i) => {
    if (turn.delta === 0) return;
    const available = Math.min(legs[i - 1].length - turns[i - 1].tangent, legs[i].length - (turns[i + 1]?.tangent ?? 0));
    if (turn.tangent > available + LENGTH_EPS) {
      problems.push({
        code: 'radius_too_large', vertex: i,
        values: { radius: turn.radius, maxRadius: Math.max(0, available) / Math.tan(Math.abs(turn.delta) / 2) },
      });
    } else if (turn.radius < halfWidth) {
      problems.push({ code: 'radius_below_half_width', vertex: i, values: { radius: turn.radius, halfWidth } });
    }
  });
  if (problems.length > 0) return { segments: [], problems };

  const segments: HorizontalSegment[] = [];
  legs.forEach((leg, j) => {
    const startTangent = turns[j].tangent;
    const endTangent = turns[j + 1]?.tangent ?? 0;
    const from: PlanXY = [points[j][0] + Math.cos(leg.direction) * startTangent, points[j][1] + Math.sin(leg.direction) * startTangent];
    const straight = leg.length - startTangent - endTangent;
    if (straight > LENGTH_EPS) segments.push(lineSegment(`line:${j}`, from, leg.direction, straight));
    const turn = turns[j + 1];
    if (turn && turn.delta !== 0) {
      const p = points[j + 1];
      const at: PlanXY = [p[0] - Math.cos(leg.direction) * endTangent, p[1] - Math.sin(leg.direction) * endTangent];
      const radius = Math.sign(turn.delta) * turn.radius;
      segments.push(arcSegment(`arc:${j + 1}`, at, leg.direction, radius, turn.radius * Math.abs(turn.delta)));
    }
  });
  return { segments, problems };
}

function orient(a: PlanXY, b: PlanXY, c: PlanXY): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function segmentsTouch(a: PlanXY, b: PlanXY, c: PlanXY, d: PlanXY): boolean {
  const scale = Math.max(Math.hypot(b[0] - a[0], b[1] - a[1]), Math.hypot(d[0] - c[0], d[1] - c[1]), 1);
  const eps = 1e-12 * scale * scale;
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  const sign = (v: number) => (Math.abs(v) <= eps ? 0 : Math.sign(v));
  const [s1, s2, s3, s4] = [o1, o2, o3, o4].map(sign);
  if (s1 * s2 < 0 && s3 * s4 < 0) return true;
  const within = (p: PlanXY, q: PlanXY, r: PlanXY) =>
    Math.min(p[0], q[0]) - 1e-12 <= r[0] && r[0] <= Math.max(p[0], q[0]) + 1e-12
    && Math.min(p[1], q[1]) - 1e-12 <= r[1] && r[1] <= Math.max(p[1], q[1]) + 1e-12;
  return (s1 === 0 && within(a, b, c)) || (s2 === 0 && within(a, b, d)) || (s3 === 0 && within(c, d, a)) || (s4 === 0 && within(c, d, b));
}

/** Whether two legs of a polyline (or polygon, when `closed`) that are not neighbours touch or cross. */
export function polylineSelfIntersects(points: readonly PlanXY[], closed: boolean): boolean {
  const count = closed ? points.length : points.length - 1;
  const legs = Array.from({ length: count }, (_, k) => {
    const a = points[k];
    const b = points[(k + 1) % points.length];
    return { k, a, b, minX: Math.min(a[0], b[0]), maxX: Math.max(a[0], b[0]), minY: Math.min(a[1], b[1]), maxY: Math.max(a[1], b[1]) };
  });
  const neighbours = (k: number, m: number) => Math.abs(k - m) <= 1 || (closed && Math.abs(k - m) === count - 1);
  const sorted = [...legs].sort((p, q) => p.minX - q.minX);
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    for (let j = i + 1; j < sorted.length && sorted[j].minX <= p.maxX + 1e-12; j++) {
      const q = sorted[j];
      if (neighbours(p.k, q.k) || q.minY > p.maxY + 1e-12 || q.maxY < p.minY - 1e-12) continue;
      if (segmentsTouch(p.a, p.b, q.a, q.b)) return true;
    }
  }
  return false;
}
