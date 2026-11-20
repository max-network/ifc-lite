/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { Point2D } from '../../types.js';
import type { PlanDimensionSide } from './types.js';

/** The building's principal axes: local u/v rotated by `angle` from drawing x/y. */
export interface PlanFrame {
  angle: number;
  u: Point2D;
  v: Point2D;
  toLocal(p: Point2D): Point2D;
  toDrawing(p: Point2D): Point2D;
}

const QUARTER = Math.PI / 2;
const BIN = Math.PI / 360;
const SNAP = Math.PI / 1800;

export function planFrame(angle: number): PlanFrame {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return {
    angle,
    u: { x: c, y: s },
    v: { x: -s, y: c },
    toLocal: (p) => ({ x: p.x * c + p.y * s, y: -p.x * s + p.y * c }),
    toDrawing: (p) => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c }),
  };
}

/** The dominant edge direction modulo 90°, length-weighted, in (-45°, 45°]. */
export function principalFrame(rings: readonly (readonly Point2D[])[]): PlanFrame {
  const edges: { theta: number; length: number }[] = [];
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i];
      const q = ring[(i + 1) % ring.length];
      const length = Math.hypot(q.x - p.x, q.y - p.y);
      if (length < 1e-6) continue;
      const theta = ((Math.atan2(q.y - p.y, q.x - p.x) % QUARTER) + QUARTER) % QUARTER;
      edges.push({ theta, length });
    }
  }
  if (edges.length === 0) return planFrame(0);
  const bins = new Float64Array(Math.round(QUARTER / BIN));
  for (const { theta, length } of edges) bins[Math.floor(theta / BIN) % bins.length] += length;
  let best = 0;
  let bestWeight = -1;
  for (let i = 0; i < bins.length; i++) {
    const weight = bins[i] + 0.5 * (bins[(i + 1) % bins.length] + bins[(i + bins.length - 1) % bins.length]);
    if (weight > bestWeight) {
      bestWeight = weight;
      best = i;
    }
  }
  const centre = (best + 0.5) * BIN;
  let cx = 0;
  let cy = 0;
  for (const { theta, length } of edges) {
    let delta = theta - centre;
    if (delta > QUARTER / 2) delta -= QUARTER;
    if (delta < -QUARTER / 2) delta += QUARTER;
    if (Math.abs(delta) > 2 * BIN) continue;
    cx += length * Math.cos(4 * theta);
    cy += length * Math.sin(4 * theta);
  }
  let angle = Math.atan2(cy, cx) / 4;
  if (angle > QUARTER / 2) angle -= QUARTER;
  if (angle <= -QUARTER / 2) angle += QUARTER;
  return planFrame(Math.abs(angle) < SNAP ? 0 : angle);
}

/** A side's frame: `s` runs along the facade, `d` grows inward from it. */
export interface SideFrame {
  side: PlanDimensionSide;
  toSide(local: Point2D): { s: number; d: number };
  toLocal(s: number, d: number): Point2D;
  /** Local unit vector of +s. */
  along: Point2D;
}

export function sideFrame(side: PlanDimensionSide): SideFrame {
  switch (side) {
    case 'top':
      return { side, toSide: (p) => ({ s: p.x, d: p.y }), toLocal: (s, d) => ({ x: s, y: d }), along: { x: 1, y: 0 } };
    case 'bottom':
      return { side, toSide: (p) => ({ s: p.x, d: -p.y }), toLocal: (s, d) => ({ x: s, y: -d }), along: { x: 1, y: 0 } };
    case 'left':
      return { side, toSide: (p) => ({ s: p.y, d: p.x }), toLocal: (s, d) => ({ x: d, y: s }), along: { x: 0, y: 1 } };
    case 'right':
      return { side, toSide: (p) => ({ s: p.y, d: -p.x }), toLocal: (s, d) => ({ x: -d, y: s }), along: { x: 0, y: 1 } };
  }
}
