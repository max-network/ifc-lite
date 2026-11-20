/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The geometry of a linear dimension, computed once for every output (canvas,
 * SVG, DXF, PDF) so they cannot disagree. Points are drawing metres; sizes are
 * paper millimetres scaled by 1:`paperScale`. The paper frame is the drawing
 * frame after the optional section flip, y down; text reads upright there.
 *
 * Layout follows the linear/aligned dimension of BIMvoice/ifc-sheet's
 * `dimension-layout.ts` (MPL-2.0): an offset instead of a through-point, and
 * architectural ticks.
 */

export interface DimensionPt {
  x: number;
  y: number;
}

export type DimensionSegment = [DimensionPt, DimensionPt];

/** Along a→b, locked to the drawing's x or y axis, or along a given unit direction. */
export type DimensionOrientation = 'aligned' | 'horizontal' | 'vertical' | DimensionPt;

export interface LinearDimension {
  a: DimensionPt;
  b: DimensionPt;
  /** Signed distance in metres from the midpoint of a and b to the dimension line, along the left normal of its direction. */
  offset: number;
  orientation: DimensionOrientation;
  /** Text override; every `<>` stands for the measured value. */
  text?: string;
  /** Moves the text from its place above the middle of the line, drawing metres. */
  textShift?: DimensionPt;
}

/** Paper sizes in millimetres. */
export const DIMENSION_PAPER_MM = {
  extensionGap: 1,
  extensionOvershoot: 2,
  tick: 2.5,
  textHeight: 2.5,
  textGap: 1,
} as const;

export interface DimensionGraphicsOptions {
  /** Drawing scale denominator (100 for 1:100). */
  paperScale: number;
  /** Formats the measured value in metres. */
  format: (metres: number) => string;
  /** The section flip the drawing is shown with. Omitted: no flip, as for a plan. */
  flip?: { flipX: boolean; flipY: boolean };
}

export interface DimensionGraphics {
  /** `lines[0]` is the dimension line; extension lines follow, one per measured point off the line. */
  lines: DimensionSegment[];
  /** One 45° tick per end of the dimension line. */
  ticks: DimensionSegment[];
  text: {
    at: DimensionPt;
    /** Baseline direction in drawing space, radians. */
    angle: number;
    /** Baseline direction in the flipped, y-down paper frame, radians in [-π/2, π/2). */
    paperAngle: number;
    heightM: number;
    value: string;
  };
  /** The measured length in metres. */
  measured: number;
}

const EPS = 1e-12;

const add = (p: DimensionPt, q: DimensionPt): DimensionPt => ({ x: p.x + q.x, y: p.y + q.y });
const scale = (p: DimensionPt, k: number): DimensionPt => ({ x: p.x * k, y: p.y * k });
const dot = (p: DimensionPt, q: DimensionPt): number => p.x * q.x + p.y * q.y;
function unit(v: DimensionPt, fallback: DimensionPt): DimensionPt {
  const l = Math.hypot(v.x, v.y);
  return l > EPS ? { x: v.x / l, y: v.y / l } : fallback;
}

/** Unit direction of the dimension line; the offset runs along its left normal `(-dir.y, dir.x)`. */
export function dimensionDirection(dim: Pick<LinearDimension, 'a' | 'b' | 'orientation'>): DimensionPt {
  const { orientation } = dim;
  if (orientation === 'horizontal') return { x: 1, y: 0 };
  if (orientation === 'vertical') return { x: 0, y: 1 };
  if (orientation === 'aligned') return unit({ x: dim.b.x - dim.a.x, y: dim.b.y - dim.a.y }, { x: 1, y: 0 });
  return unit(orientation, { x: 1, y: 0 });
}

/** The length a dimension measures, metres: the distance a→b along its direction. */
export function linearDimensionLength(dim: Pick<LinearDimension, 'a' | 'b' | 'orientation'>): number {
  const d = { x: dim.b.x - dim.a.x, y: dim.b.y - dim.a.y };
  if (dim.orientation === 'aligned') return Math.hypot(d.x, d.y);
  return Math.abs(dot(d, dimensionDirection(dim)));
}

/** The text a dimension shows: the formatted value, or the override with each `<>` replaced by it. */
export function dimensionText(text: string | undefined, formatted: string): string {
  return text === undefined ? formatted : text.split('<>').join(formatted);
}

/** Paper text width estimate in millimetres, generous for proportional fonts. */
export function dimensionTextWidthMm(value: string): number {
  return DIMENSION_PAPER_MM.textHeight * 0.7 * Math.max(1, value.length);
}

export function linearDimensionGraphics(dim: LinearDimension, options: DimensionGraphicsOptions): DimensionGraphics {
  const mm = (paperMm: number) => (paperMm * options.paperScale) / 1000;
  const gap = mm(DIMENSION_PAPER_MM.extensionGap);
  const over = mm(DIMENSION_PAPER_MM.extensionOvershoot);
  const tickHalf = mm(DIMENSION_PAPER_MM.tick) / 2;
  const heightM = mm(DIMENSION_PAPER_MM.textHeight);

  const { a, b } = dim;
  const dir = dimensionDirection(dim);
  const n = { x: -dir.y, y: dir.x };
  const mid = scale(add(a, b), 0.5);
  const offA = dim.offset + dot({ x: mid.x - a.x, y: mid.y - a.y }, n);
  const offB = dim.offset + dot({ x: mid.x - b.x, y: mid.y - b.y }, n);
  const pa = add(a, scale(n, offA));
  const pb = add(b, scale(n, offB));

  const lines: DimensionSegment[] = [[pa, pb]];
  for (const [p, foot, off] of [[a, pa, offA], [b, pb, offB]] as const) {
    if (Math.abs(off) <= EPS) continue;
    const s = Math.sign(off);
    lines.push([add(p, scale(n, s * Math.min(gap, Math.abs(off)))), add(foot, scale(n, s * over))]);
  }

  const fx = options.flip?.flipX ? -1 : 1;
  const fy = options.flip?.flipY ? -1 : 1;
  const paper = (v: DimensionPt): DimensionPt => ({ x: v.x * fx, y: v.y * fy });
  let along = paper(unit({ x: pb.x - pa.x, y: pb.y - pa.y }, dir));
  if (along.x < -1e-9 || (Math.abs(along.x) <= 1e-9 && along.y > 0)) along = scale(along, -1);
  const upPaper = { x: along.y, y: -along.x };
  const tickPaper = scale(add(along, upPaper), Math.SQRT1_2);
  const alongD = paper(along);
  const upD = paper(upPaper);
  const tickD = paper(tickPaper);

  const ticks: DimensionSegment[] = [pa, pb].map((foot): DimensionSegment => [
    add(foot, scale(tickD, -tickHalf)),
    add(foot, scale(tickD, tickHalf)),
  ]);

  const measured = linearDimensionLength(dim);
  const at = add(scale(add(pa, pb), 0.5), scale(upD, mm(DIMENSION_PAPER_MM.textGap) + heightM / 2));
  return {
    lines,
    ticks,
    text: {
      at: dim.textShift ? add(at, dim.textShift) : at,
      angle: Math.atan2(alongD.y, alongD.x),
      paperAngle: Math.atan2(along.y, along.x),
      heightM,
      value: dimensionText(dim.text, options.format(measured)),
    },
    measured,
  };
}
