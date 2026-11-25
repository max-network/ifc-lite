/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { IfcAttributeValue } from '@ifc-lite/data';
import type { StoreEditor } from '@ifc-lite/mutations';
import type { SpatialAnchorSchema } from '../anchor.js';
import { schemaRegistry } from '../schema-attributes.js';

export type Pt2 = readonly [number, number];

export type PathSegment =
  | { readonly kind: 'line'; readonly to: Pt2 }
  | { readonly kind: 'arc'; readonly via: Pt2; readonly to: Pt2 };

export interface ProfilePath {
  readonly start: Pt2;
  readonly segments: readonly PathSegment[];
}

const SAME_POINT = 1e-9;
const DEFAULT_ARC_PIECES = 24;

const same = (a: Pt2, b: Pt2) => Math.abs(a[0] - b[0]) <= SAME_POINT && Math.abs(a[1] - b[1]) <= SAME_POINT;

export function linePath(points: readonly Pt2[]): ProfilePath {
  return { start: points[0], segments: points.slice(1).map((to) => ({ kind: 'line', to })) };
}

export function circlePath(radius: number): ProfilePath {
  return {
    start: [radius, 0],
    segments: [
      { kind: 'arc', via: [0, radius], to: [-radius, 0] },
      { kind: 'arc', via: [0, -radius], to: [radius, 0] },
    ],
  };
}

export function scalePath(path: ProfilePath, scale: (value: number) => number): ProfilePath {
  const at = ([x, y]: Pt2): Pt2 => [scale(x), scale(y)];
  return {
    start: at(path.start),
    segments: path.segments.map((s) => (s.kind === 'line' ? { kind: 'line', to: at(s.to) } : { kind: 'arc', via: at(s.via), to: at(s.to) })),
  };
}

export function withoutRepeats(path: ProfilePath): ProfilePath {
  const segments: PathSegment[] = [];
  let at = path.start;
  for (const segment of path.segments) {
    if (same(segment.to, at) && segment.kind === 'line') continue;
    segments.push(segment);
    at = segment.to;
  }
  if (segments.length && same(segments[segments.length - 1].to, path.start) && segments[segments.length - 1].kind === 'line') segments.pop();
  return { start: path.start, segments };
}

export function circleThrough(a: Pt2, b: Pt2, c: Pt2): { cx: number; cy: number; r: number } | null {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-15) return null;
  const sq = (p: Pt2) => p[0] * p[0] + p[1] * p[1];
  const cx = (sq(a) * (b[1] - c[1]) + sq(b) * (c[1] - a[1]) + sq(c) * (a[1] - b[1])) / d;
  const cy = (sq(a) * (c[0] - b[0]) + sq(b) * (a[0] - c[0]) + sq(c) * (b[0] - a[0])) / d;
  return { cx, cy, r: Math.hypot(a[0] - cx, a[1] - cy) };
}

export function sampleArc(from: Pt2, via: Pt2, to: Pt2, pieces = DEFAULT_ARC_PIECES): Pt2[] {
  const circle = circleThrough(from, via, to);
  if (!circle) return [via, to];
  const tau = 2 * Math.PI;
  const norm = (t: number) => ((t % tau) + tau) % tau;
  const angle = (p: Pt2) => Math.atan2(p[1] - circle.cy, p[0] - circle.cx);
  const start = angle(from);
  const ccw = norm(angle(via) - start) < norm(angle(to) - start);
  const turn = (a: number, b: number) => (ccw ? norm(b - a) : -norm(a - b));
  const run = (begin: number, sweep: number, end: Pt2): Pt2[] => {
    const n = Math.max(1, Math.ceil(pieces * Math.abs(sweep) / Math.PI));
    return Array.from({ length: n }, (_, i): Pt2 => {
      if (i === n - 1) return end;
      const t = begin + (sweep * (i + 1)) / n;
      return [circle.cx + circle.r * Math.cos(t), circle.cy + circle.r * Math.sin(t)];
    });
  };
  return [...run(start, turn(start, angle(via)), via), ...run(angle(via), turn(angle(via), angle(to)), to)];
}

export function pathPoints(path: ProfilePath, pieces = DEFAULT_ARC_PIECES): Pt2[] {
  const points: Pt2[] = [path.start];
  for (const segment of path.segments) {
    const from = points[points.length - 1];
    points.push(...(segment.kind === 'line' ? [segment.to] : sampleArc(from, segment.via, segment.to, pieces)));
  }
  if (points.length > 1 && same(points[points.length - 1], points[0])) points.pop();
  return points;
}

type IndexSegment = { typed: { type: string; value: number[] } };

function indexedSegments(path: ProfilePath): { coords: Pt2[]; segments: IndexSegment[] } {
  const coords: Pt2[] = [path.start];
  const index = (p: Pt2): number => {
    if (same(p, path.start)) return 1;
    coords.push(p);
    return coords.length;
  };
  const segments: IndexSegment[] = [];
  let at = 1;
  const steps = [...path.segments];
  if (!same(steps.length ? steps[steps.length - 1].to : path.start, path.start)) steps.push({ kind: 'line', to: path.start });
  for (const segment of steps) {
    if (segment.kind === 'line') {
      const next = index(segment.to);
      const last = segments[segments.length - 1];
      if (last?.typed.type === 'IFCLINEINDEX') last.typed.value.push(next);
      else segments.push({ typed: { type: 'IFCLINEINDEX', value: [at, next] } });
      at = next;
    } else {
      const via = index(segment.via);
      const next = index(segment.to);
      segments.push({ typed: { type: 'IFCARCINDEX', value: [at, via, next] } });
      at = next;
    }
  }
  return { coords, segments };
}

export function emitPathCurve(editor: StoreEditor, schema: SpatialAnchorSchema | undefined, path: ProfilePath): number {
  const clean = withoutRepeats(path);
  if (clean.segments.length < 2) throw new Error('A profile outline needs at least two segments');
  if ((schema ?? 'IFC4') === 'IFC2X3') {
    const points = pathPoints(clean);
    const ids = [...points, points[0]].map((p) => `#${editor.addEntity('IfcCartesianPoint', [[p[0], p[1]]]).expressId}`);
    return editor.addEntity('IfcPolyline', [ids]).expressId;
  }
  const { coords, segments } = indexedSegments(clean);
  const list = editor.addEntity('IfcCartesianPointList2D', padded(schema, 'IfcCartesianPointList2D', [coords.map((p) => [p[0], p[1]])])).expressId;
  return editor.addEntity('IfcIndexedPolyCurve', [`#${list}`, segments, false]).expressId;
}

export function padded(schema: SpatialAnchorSchema | undefined, type: string, values: IfcAttributeValue[]): IfcAttributeValue[] {
  const count = schemaRegistry(schema, type).entities[type]?.allAttributes?.length ?? values.length;
  return [...values, ...Array.from({ length: Math.max(0, count - values.length) }, () => null)];
}

export function emitPathProfile(editor: StoreEditor, schema: SpatialAnchorSchema | undefined, outer: ProfilePath, voids: readonly ProfilePath[] = []): number {
  const outerId = emitPathCurve(editor, schema, outer);
  if (voids.length === 0) return editor.addEntity('IfcArbitraryClosedProfileDef', ['.AREA.', null, `#${outerId}`]).expressId;
  const inner = voids.map((path) => `#${emitPathCurve(editor, schema, path)}`);
  return editor.addEntity('IfcArbitraryProfileDefWithVoids', ['.AREA.', null, `#${outerId}`, inner]).expressId;
}
