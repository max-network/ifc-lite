/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export type ArchKind = 'segmental' | 'round' | 'pointed';

export interface ArchCircle {
  readonly cx: number;
  readonly cz: number;
  readonly r: number;
}

export interface ArchShape {
  readonly span: number;
  readonly rise: number;
  readonly kind: ArchKind;
  readonly left: ArchCircle;
  readonly right: ArchCircle;
}

const ROUND_TOLERANCE = 1e-6;
export const ARC_CHORD_TOLERANCE = 0.005;
export const KERNEL_MIN_ARC_CHORDS = 4;

export function archShape(span: number, rise: number): ArchShape {
  if (!Number.isFinite(span) || span <= 0) throw new Error(`An arch needs a positive finite span; got ${span}`);
  if (!Number.isFinite(rise) || rise <= 0) throw new Error(`An arch needs a positive finite rise; got ${rise}`);
  const half = span / 2;
  if (Math.abs(rise - half) <= ROUND_TOLERANCE * span) {
    const circle = { cx: 0, cz: 0, r: half };
    return { span, rise: half, kind: 'round', left: circle, right: circle };
  }
  if (rise < half) {
    const r = (half * half + rise * rise) / (2 * rise);
    const circle = { cx: 0, cz: rise - r, r };
    return { span, rise, kind: 'segmental', left: circle, right: circle };
  }
  const r = (half * half + rise * rise) / span;
  return { span, rise, kind: 'pointed', left: { cx: r - half, cz: 0, r }, right: { cx: half - r, cz: 0, r } };
}

export function archCircleAt(arch: ArchShape, x: number): ArchCircle {
  return x <= 0 ? arch.left : arch.right;
}

export function archHeightAt(arch: ArchShape, x: number, offset = 0): number | null {
  const circle = archCircleAt(arch, x);
  const r = circle.r + offset;
  const d = x - circle.cx;
  const under = r * r - d * d;
  if (r <= 0 || under < -1e-12) return null;
  return circle.cz + Math.sqrt(Math.max(0, under));
}

export function archCrown(arch: ArchShape, offset = 0): number {
  return archHeightAt(arch, 0, offset) ?? arch.rise + offset;
}

const MAX_CHORDS = 4096;

export function chordSegments(radius: number, angle: number, tolerance: number): number {
  if (!(radius > 0) || !(angle > 0)) return 1;
  if (!(tolerance > 0)) throw new Error(`A chord tolerance must be positive; got ${tolerance}`);
  if (tolerance >= radius) return 1;
  return Math.min(MAX_CHORDS, Math.max(1, Math.ceil(angle / (2 * Math.acos(1 - tolerance / radius)) - 1e-9)));
}

function leftAngles(arch: ArchShape, offset: number): { circle: ArchCircle; start: number; end: number; r: number } {
  const circle = arch.left;
  const half = arch.span / 2;
  const r = circle.r + offset;
  const start = Math.atan2((archHeightAt(arch, -half, offset) ?? 0) - circle.cz, -half - circle.cx);
  const end = Math.atan2(archCrown(arch, offset) - circle.cz, -circle.cx);
  return { circle, start, end, r };
}

function anglesToX(circle: ArchCircle, r: number, start: number, end: number, pieces: number): number[] {
  return Array.from({ length: pieces + 1 }, (_, i) => circle.cx + r * Math.cos(start + ((end - start) * i) / pieces));
}

export function archSampleOffsets(arch: ArchShape, tolerance: number, outerOffset = 0): number[] {
  const half = arch.span / 2;
  const { circle, start, end } = leftAngles(arch, 0);
  const pieces = chordSegments(circle.r + Math.max(0, outerOffset), Math.abs(end - start), tolerance);
  const left = anglesToX(circle, circle.r, start, end, pieces);
  left[0] = -half;
  left[pieces] = 0;
  return [...left, ...left.slice(0, pieces).reverse().map((x) => -x)];
}

export interface ArcPiece {
  readonly via: [number, number];
  readonly to: [number, number];
}

export function archArcs(arch: ArchShape, offset: number, fromX: number, toX: number, tolerance: number, minChords: number): ArcPiece[] {
  if (fromX * toX < 0) return [...archArcs(arch, offset, fromX, 0, tolerance, minChords), ...archArcs(arch, offset, 0, toX, tolerance, minChords)];
  const c = archCircleAt(arch, (fromX + toX) / 2);
  const r = c.r + offset;
  const at = (x: number): [number, number] => [x, x === 0 ? archCrown(arch, offset) : archHeightAt(arch, x, offset) ?? 0];
  const angle = ([x, z]: [number, number]) => Math.atan2(z - c.cz, x - c.cx);
  const start = angle(at(fromX)), end = angle(at(toX));
  const widest = tolerance >= r ? Math.PI : 2 * minChords * Math.acos(1 - tolerance / r);
  const pieces = Math.max(1, Math.ceil(Math.abs(end - start) / widest - 1e-9));
  const on = (t: number): [number, number] => [c.cx + r * Math.cos(t), c.cz + r * Math.sin(t)];
  return Array.from({ length: pieces }, (_, k): ArcPiece => ({
    via: on(start + ((end - start) * (k + 0.5)) / pieces),
    to: k === pieces - 1 ? at(toX) : on(start + ((end - start) * (k + 1)) / pieces),
  }));
}
