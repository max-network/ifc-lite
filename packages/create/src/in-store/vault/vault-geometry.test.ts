/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { archShape, type ArchCircle } from '../arch/arch-shape.js';
import { pathPoints, type Pt2 } from '../arch/profile-path.js';
import { barrelProfile, crossVaultFaces, crossVaultGroins, type FaceSet, type Vec3 } from './vault-geometry.js';

const TOLERANCE = 0.005;
const KERNEL_MIN_CHORDS = 4;

function signedVolume({ coords, faces }: FaceSet): number {
  let volume = 0;
  for (const face of faces) {
    for (let i = 1; i + 1 < face.length; i++) {
      const [a, b, c] = [coords[face[0]], coords[face[i]], coords[face[i + 1]]];
      volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    }
  }
  return volume;
}

function unpairedEdges({ faces }: FaceSet): string[] {
  const directed = new Map<string, number>();
  for (const face of faces) face.forEach((a, i) => {
    const key = `${a}>${face[(i + 1) % face.length]}`;
    directed.set(key, (directed.get(key) ?? 0) + 1);
  });
  return [...directed.keys()].filter((key) => {
    const [a, b] = key.split('>');
    return directed.get(key) !== 1 || directed.get(`${b}>${a}`) !== 1;
  });
}

const offCircle = ([x, z]: Pt2, c: ArchCircle, offset = 0) => Math.abs(Math.hypot(x - c.cx, z - c.cz) - (c.r + offset));

function barrelHeight(span: number, rise: number, offset: number, x: number): number {
  const { left: c } = archShape(span, rise);
  const clamped = Math.max(-span / 2, Math.min(span / 2, x));
  return c.cz + Math.sqrt(Math.max(0, (c.r + offset) ** 2 - clamped ** 2));
}

describe('barrelProfile', () => {
  for (const [span, rise, thickness] of [[4, 0.8, 0.3], [4, 2, 0.25], [11, 5.5, 0.4]]) {
    it(`puts a ${span} m / ${rise} m barrel's intrados on r and its extrados on r + t, with chords a four-chord kernel keeps within ${TOLERANCE * 1000} mm`, () => {
      const profile = barrelProfile(span, rise, thickness, TOLERANCE);
      const circle = archShape(span, rise).left;
      let from = profile.start;
      let crossedWall = false;
      for (const segment of profile.segments) {
        if (segment.kind === 'line') crossedWall = true;
        else {
          const offset = crossedWall ? thickness : 0;
          expect(offCircle(segment.via, circle, offset)).toBeLessThan(1e-9);
          expect(offCircle(segment.to, circle, offset)).toBeLessThan(1e-9);
          const angle = (p: Pt2) => Math.atan2(p[1] - circle.cz, p[0] - circle.cx);
          const sweep = Math.abs(angle(segment.to) - angle(from));
          expect((circle.r + offset) * (1 - Math.cos(sweep / (2 * KERNEL_MIN_CHORDS)))).toBeLessThanOrEqual(TOLERANCE + 1e-12);
        }
        from = segment.to;
      }
      const zs = pathPoints(profile, 64).map((p) => p[1]);
      expect(Math.min(...zs)).toBeCloseTo(0, 9);
      expect(Math.max(...zs)).toBeCloseTo(rise + thickness, 9);
    });
  }
});

describe('crossVaultFaces', () => {
  const W = 4, D = 6, RISE = 0.8, T = 0.3;
  const vault = crossVaultFaces(W, D, RISE, T, TOLERANCE);
  const a = (x: number, offset = 0) => barrelHeight(W, RISE, offset, x - W / 2);
  const b = (y: number, offset = 0) => barrelHeight(D, RISE, offset, y - D / 2);
  const intrados = ([x, y]: Vec3) => Math.max(a(x), b(y));
  const extrados = ([x, y]: Vec3) => Math.max(a(x, T), b(y, T));

  it('is a closed, outward-facing solid without cracks', () => {
    expect(unpairedEdges(vault)).toEqual([]);
    expect(signedVolume(vault)).toBeGreaterThan(0);
    expect(signedVolume(vault)).toBeLessThan(W * D * (RISE + T));
  });

  it('puts every vertex on the intrados or extrados of two circular barrels with the same crown', () => {
    for (const p of vault.coords) {
      expect(Math.min(Math.abs(p[2] - intrados(p)), Math.abs(p[2] - extrados(p)))).toBeLessThan(1e-9);
    }
  });

  it('crowns at the centre at the rise, extrados a thickness above, and springs from the corners', () => {
    const at = (x: number, y: number) => vault.coords.filter((p) => Math.abs(p[0] - x) < 1e-9 && Math.abs(p[1] - y) < 1e-9).map((p) => p[2]).sort((m, n) => m - n);
    expect(at(W / 2, D / 2)).toEqual([expect.closeTo(RISE, 9), expect.closeTo(RISE + T, 9)]);
    for (const [x, y] of [[0, 0], [W, 0], [W, D], [0, D]]) expect(at(x, y)[0]).toBeCloseTo(0, 9);
  });

  it('keeps each intrados facet within the chord tolerance of its own barrel', () => {
    for (const face of vault.faces) {
      const points = face.map((i) => vault.coords[i]);
      if (!points.every((p) => Math.abs(p[2] - intrados(p)) < 1e-9)) continue;
      const mean = (k: number) => points.reduce((sum, p) => sum + p[k], 0) / points.length;
      const c: Vec3 = [mean(0), mean(1), mean(2)];
      const ownsA = points.every((p) => Math.abs(p[2] - a(p[0])) < 1e-9);
      const circle = archShape(ownsA ? W : D, RISE).left;
      const across = ownsA ? c[0] - W / 2 : c[1] - D / 2;
      expect(offCircle([across, c[2]], circle)).toBeLessThanOrEqual(TOLERANCE + 1e-9);
    }
  });

  it('meets along groins that are vertices of the mesh and lie on both barrels', () => {
    const groins = crossVaultGroins(W, D, RISE, TOLERANCE);
    expect(groins).toHaveLength(4);
    const keys = new Set(vault.coords.map((p) => p.map((v) => v.toFixed(9)).join()));
    for (const groin of groins) {
      expect(groin.length).toBeGreaterThan(4);
      for (const p of groin) {
        expect(p[2]).toBeCloseTo(a(p[0]), 9);
        expect(p[2]).toBeCloseTo(b(p[1]), 9);
        expect(keys.has(p.map((v) => v.toFixed(9)).join())).toBe(true);
      }
    }
  });

  it('runs a square bay\'s groins in the diagonal vertical planes along ellipses with semi-axes r√2 and r', () => {
    const S = 5, rise = 2.5, { left: c } = archShape(S, rise);
    for (const groin of crossVaultGroins(S, S, rise, TOLERANCE)) {
      for (const [x, y, z] of groin) {
        const u = x - S / 2, v = y - S / 2;
        expect(Math.abs(Math.abs(u) - Math.abs(v))).toBeLessThan(1e-9);
        const d = Math.hypot(u, v);
        expect((d / (c.r * Math.SQRT2)) ** 2 + ((z - c.cz) / c.r) ** 2).toBeCloseTo(1, 9);
      }
    }
  });
});
