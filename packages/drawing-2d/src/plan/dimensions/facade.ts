/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { Point2D } from '../../types.js';
import type { SideFrame } from './frame.js';

/** A stretch of facade as seen from outside: a wall face, or an opening closed at the face line. */
export interface FacadeRun {
  s0: number;
  s1: number;
  /** Depth of the face, growing inward. */
  d: number;
  opening: boolean;
}

/** A measured point of an exterior chain: position along the facade and depth of the face it sits on. */
export interface FacadeStation {
  s: number;
  d: number;
}

const TOL = 1e-3;
const PARALLEL = Math.sin(Math.PI / 180);
const MIN_RUN = 0.02;

interface FacingEdge {
  s0: number;
  s1: number;
  d: number;
}

interface JambEdge {
  s: number;
  d0: number;
  d1: number;
}

function signedArea(points: readonly { s: number; d: number }[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    area += p.s * q.d - q.s * p.d;
  }
  return area / 2;
}

function sideEdges(rings: readonly (readonly Point2D[])[], frame: SideFrame): { facing: FacingEdge[]; jambs: JambEdge[] } {
  const facing: FacingEdge[] = [];
  const jambs: JambEdge[] = [];
  for (const ring of rings) {
    const points = ring.map(frame.toSide);
    const area = signedArea(points);
    if (Math.abs(area) < 1e-9) continue;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const q = points[(i + 1) % points.length];
      const ds = q.s - p.s;
      const dd = q.d - p.d;
      const length = Math.hypot(ds, dd);
      if (length < TOL) continue;
      if (Math.abs(dd) <= PARALLEL * length) {
        if (ds > 0 === area > 0) facing.push({ s0: Math.min(p.s, q.s), s1: Math.max(p.s, q.s), d: (p.d + q.d) / 2 });
      } else if (Math.abs(ds) <= PARALLEL * length) {
        jambs.push({ s: (p.s + q.s) / 2, d0: Math.min(p.d, q.d), d1: Math.max(p.d, q.d) });
      }
    }
  }
  return { facing, jambs };
}

function envelope(facing: readonly FacingEdge[]): FacadeRun[] {
  const cuts = [...new Set(facing.flatMap((e) => [e.s0, e.s1]))].sort((a, b) => a - b);
  const runs: FacadeRun[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const a = cuts[i];
    const b = cuts[i + 1];
    if (b - a < 1e-6) continue;
    let d = Infinity;
    for (const e of facing) if (e.s0 <= a + 1e-9 && e.s1 >= b - 1e-9 && e.d < d) d = e.d;
    const last = runs[runs.length - 1];
    if (last && Math.abs(last.s1 - a) < 1e-6 && (last.d === d || Math.abs(last.d - d) <= TOL)) last.s1 = b;
    else runs.push({ s0: a, s1: b, d, opening: false });
  }
  while (runs.length > 0 && runs[0].d === Infinity) runs.shift();
  while (runs.length > 0 && runs[runs.length - 1].d === Infinity) runs.pop();
  return runs;
}

function dropSlivers(runs: FacadeRun[]): FacadeRun[] {
  const out = runs.map((r) => ({ ...r }));
  for (let i = 0; i < out.length; ) {
    const run = out[i];
    if (run.opening || run.d === Infinity || run.s1 - run.s0 >= MIN_RUN || out.length === 1) {
      i++;
      continue;
    }
    const prev = out[i - 1];
    const next = out[i + 1];
    const into = !next || (prev && Math.abs(prev.d - run.d) <= Math.abs(next.d - run.d)) ? prev : next;
    if (into === prev) prev.s1 = run.s1;
    else next.s0 = run.s0;
    out.splice(i, 1);
    i = Math.max(0, i - 1);
  }
  const merged: FacadeRun[] = [];
  for (const run of out) {
    const last = merged[merged.length - 1];
    if (last && !last.opening && !run.opening && Math.abs(last.s1 - run.s0) < 1e-6 && Math.abs(last.d - run.d) <= TOL) last.s1 = run.s1;
    else merged.push(run);
  }
  return merged;
}

function endsAsJamb(jambs: readonly JambEdge[], s: number, d: number, maxWall: number): boolean {
  let found = false;
  for (const j of jambs) {
    if (Math.abs(j.s - s) > TOL || j.d0 < d - TOL || j.d0 > d + maxWall + TOL) continue;
    if (j.d1 > d + maxWall + TOL) return false;
    found = true;
  }
  return found;
}

function closeOpenings(runs: FacadeRun[], jambs: readonly JambEdge[], maxWall: number): FacadeRun[] {
  let current = runs;
  for (;;) {
    let best: { i: number; j: number; width: number } | undefined;
    for (let i = 0; i < current.length; i++) {
      const face = current[i];
      if (face.d === Infinity) continue;
      for (let j = i + 1; j < current.length; j++) {
        const other = current[j];
        if (other.d > face.d + TOL) continue;
        const width = other.s0 - face.s1;
        if (j > i + 1 && Math.abs(other.d - face.d) <= TOL && endsAsJamb(jambs, face.s1, face.d, maxWall) && endsAsJamb(jambs, other.s0, face.d, maxWall)) {
          if (!best || width < best.width) best = { i, j, width };
        }
        break;
      }
    }
    if (!best) return current;
    const { i, j } = best;
    const opening: FacadeRun = { s0: current[i].s1, s1: current[j].s0, d: current[i].d, opening: true };
    current = [...current.slice(0, i + 1), opening, ...current.slice(j)];
  }
}

/** The facade of `rings` (local frame) seen from `frame`'s side, openings closed at the face line. */
export function facadeRuns(rings: readonly (readonly Point2D[])[], frame: SideFrame, maxWallThickness: number): FacadeRun[] {
  const { facing, jambs } = sideEdges(rings, frame);
  const runs = closeOpenings(envelope(facing), jambs, maxWallThickness);
  return dropSlivers(runs).filter((r) => r.d !== Infinity);
}

/** A door or window footprint in a side frame. */
export interface FacadeFilling {
  s0: number;
  s1: number;
  d0: number;
  d1: number;
}

function fillingJambs(run: FacadeRun, fillings: readonly FacadeFilling[], maxWall: number): number[] {
  const jambs: number[] = [];
  for (const f of fillings) {
    if (f.d1 < run.d - TOL || f.d0 > run.d + maxWall || f.s1 < run.s0 - TOL || f.s0 > run.s1 + TOL) continue;
    for (const s of [f.s0, f.s1]) if (s > run.s0 + MIN_RUN && s < run.s1 - MIN_RUN) jambs.push(s);
  }
  return jambs.sort((a, b) => a - b).filter((s, i, all) => i === 0 || s - all[i - 1] > MIN_RUN);
}

/** Every corner, step and jamb along the facade, each on the outer of the faces meeting there; doors and windows split the openings they fill. */
export function facadeStations(runs: readonly FacadeRun[], fillings: readonly FacadeFilling[] = [], maxWall = 1): FacadeStation[] {
  if (runs.length === 0) return [];
  const stations: FacadeStation[] = [{ s: runs[0].s0, d: runs[0].d }];
  const inner = (run: FacadeRun) => {
    if (run.opening) for (const s of fillingJambs(run, fillings, maxWall)) stations.push({ s, d: run.d });
  };
  inner(runs[0]);
  for (let i = 1; i < runs.length; i++) {
    const prev = runs[i - 1];
    const next = runs[i];
    if (Math.abs(prev.s1 - next.s0) <= TOL) {
      if (Math.abs(prev.d - next.d) > TOL || prev.opening !== next.opening) stations.push({ s: next.s0, d: Math.min(prev.d, next.d) });
    } else {
      stations.push({ s: prev.s1, d: prev.d }, { s: next.s0, d: next.d });
    }
    inner(next);
  }
  const last = runs[runs.length - 1];
  stations.push({ s: last.s1, d: last.d });
  return stations;
}
