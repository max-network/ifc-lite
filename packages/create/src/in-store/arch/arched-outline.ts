/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { ARC_CHORD_TOLERANCE, KERNEL_MIN_ARC_CHORDS, archArcs, archHeightAt, archShape, type ArchShape } from './arch-shape.js';
import { linePath, withoutRepeats, type PathSegment, type ProfilePath } from './profile-path.js';

export interface ArchedHead {
  readonly width: number;
  readonly height: number;
  readonly rise: number;
}

export interface Rect {
  readonly x0: number;
  readonly z0: number;
  readonly x1: number;
  readonly z1: number;
}

const EPS = 1e-9;

function springing(head: ArchedHead): { arch: ArchShape; zs: number } {
  return { arch: archShape(head.width, head.rise), zs: head.height - head.rise };
}

function innerTop(head: ArchedHead, inset: number): (x: number) => number | null {
  const { arch, zs } = springing(head);
  return (x) => {
    const z = archHeightAt(arch, x, -inset);
    return z === null ? null : zs + z;
  };
}

export function archedOpeningPath(head: ArchedHead): ProfilePath {
  const half = head.width / 2;
  const { zs } = springing(head);
  return withoutRepeats({
    start: [-half, 0],
    segments: [
      { kind: 'line', to: [half, 0] },
      { kind: 'line', to: [half, zs] },
      ...innerArc(head, 0, half, -half),
    ],
  });
}

function innerArc(head: ArchedHead, inset: number, fromX: number, toX: number): PathSegment[] {
  const { arch, zs } = springing(head);
  return archArcs(arch, -inset, fromX, toX, ARC_CHORD_TOLERANCE, KERNEL_MIN_ARC_CHORDS)
    .map(({ via, to }): PathSegment => ({ kind: 'arc', via: [via[0], zs + via[1]], to: [to[0], zs + to[1]] }));
}

export function archedRingPaths(head: ArchedHead, wall: number): { outer: ProfilePath; inner: ProfilePath } {
  const a = head.width / 2 - wall;
  const top = innerTop(head, wall);
  const jamb = top(a) ?? head.height - head.rise;
  return {
    outer: archedOpeningPath(head),
    inner: withoutRepeats({
      start: [-a, wall],
      segments: [{ kind: 'line', to: [a, wall] }, { kind: 'line', to: [a, jamb] }, ...innerArc(head, wall, a, -a)],
    }),
  };
}

export function archedFramePath(head: ArchedHead, wall: number): ProfilePath {
  const half = head.width / 2;
  const a = half - wall;
  const { zs } = springing(head);
  const jamb = innerTop(head, wall)(a) ?? zs;
  return withoutRepeats({
    start: [-half, 0],
    segments: [
      { kind: 'line', to: [-a, 0] },
      { kind: 'line', to: [-a, jamb] },
      ...innerArc(head, wall, -a, a),
      { kind: 'line', to: [a, 0] },
      { kind: 'line', to: [half, 0] },
      { kind: 'line', to: [half, zs] },
      ...innerArc(head, 0, half, -half),
    ],
  });
}

function levelCrossing(head: ArchedHead, inset: number, z: number): number | null {
  const { arch, zs } = springing(head);
  const circle = arch.left;
  const r = circle.r - inset;
  const dz = z - zs - circle.cz;
  if (dz < 0) return r;
  if (dz > r) return null;
  return Math.sqrt(r * r - dz * dz);
}

export function rectUnderArch(rect: Rect, head: ArchedHead, inset: number): ProfilePath | null {
  const top = innerTop(head, inset);
  const reach = levelCrossing(head, inset, rect.z0);
  if (reach === null) return null;
  const x0 = Math.max(rect.x0, -reach);
  const x1 = Math.min(rect.x1, reach);
  if (x1 - x0 <= EPS) return null;
  const flat = levelCrossing(head, inset, rect.z1);
  if (flat !== null && flat >= Math.max(-x0, x1) - EPS) return linePath([[x0, rect.z0], [x1, rect.z0], [x1, rect.z1], [x0, rect.z1]]);
  const heightAt = (x: number) => Math.min(rect.z1, top(x) ?? rect.z0);
  const segments: PathSegment[] = [{ kind: 'line', to: [x1, rect.z0] }, { kind: 'line', to: [x1, heightAt(x1)] }];
  if (flat === null) segments.push(...innerArc(head, inset, x1, x0));
  else {
    if (x1 > flat) segments.push(...innerArc(head, inset, x1, flat));
    segments.push({ kind: 'line', to: [Math.min(x1, flat), rect.z1] }, { kind: 'line', to: [Math.max(x0, -flat), rect.z1] });
    if (x0 < -flat) segments.push(...innerArc(head, inset, -flat, x0));
  }
  return withoutRepeats({ start: [x0, rect.z0], segments });
}
