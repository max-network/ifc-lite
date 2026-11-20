/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { describe, expect, it } from 'vitest';
import { parse } from './__test__/storey-fixtures.oracle.js';
import { exportText, newStorey } from './wall-join-mesh.oracle.js';
import { addRoofToStore } from './roof.js';
import { addWallToStore } from './wall.js';
import { setTopConstraintInStore } from './storey/storey-top-constraint.js';
import { readWallJoinTarget } from './wall-join-read.js';
import { readRoofClippedWallTop } from './wall-roof-clip.js';
import { readFootprintRoofInStore } from './roof-footprint.js';

const SLOPE = Math.PI / 6;

async function gableWall() {
  const s = await newStorey();
  const roofId = addRoofToStore(s.editor, s.anchor, { Position: [0, 0, 4], Width: 10, Depth: 8, Thickness: .25, EdgeSlopes: [SLOPE, 0, SLOPE, 0], Overhang: .5 }).roofId;
  const wallId = addWallToStore(s.editor, s.anchor, { Start: [5, 0, 1], End: [5, 8, 1], Height: 3, Thickness: .2 }).wallId;
  setTopConstraintInStore(s.store, s.editor, wallId, { kind: 'roof', roofId });
  return { s, roofId, wallId };
}

describe('a wall cut to a roof underside', () => {
  it('reads as a join target from the saved file without a mutation view', async () => {
    const { s, wallId } = await gableWall();
    const reopened = await parse(exportText(s));
    const target = readWallJoinTarget(reopened, null, wallId, 1);
    expect(target?.wall.start).toEqual([5, 0]);
    expect(target?.wall.end).toEqual([5, 8]);
    expect(target?.wall.thickness).toBeCloseTo(.2, 9);
  });

  it('reports its top above its base along its axis, the gable peak included', async () => {
    const { s, roofId, wallId } = await gableWall();
    const profile = readRoofClippedWallTop(s.store, s.view, wallId, roofId);
    const top = (y: number) => 3 + Math.min(y, 8 - y) * Math.tan(SLOPE);
    expect(profile?.[0]?.at).toBeCloseTo(0, 9);
    expect(profile?.[0]?.height).toBeCloseTo(top(0), 6);
    expect(profile?.[profile.length - 1]?.at).toBeCloseTo(8, 9);
    expect(Math.max(...(profile ?? []).map((p) => p.height))).toBeCloseTo(top(4), 6);
    const peak = profile?.find((p) => Math.abs(p.at - 4) < 1e-6);
    expect(peak?.height).toBeCloseTo(top(4), 6);
  });

  it('reads the same top from the saved file', async () => {
    const { s, roofId, wallId } = await gableWall();
    const reopened = await parse(exportText(s));
    const profile = readRoofClippedWallTop(reopened, null, wallId, roofId);
    expect(Math.max(...(profile ?? []).map((p) => p.height))).toBeCloseTo(3 + 4 * Math.tan(SLOPE), 6);
  });

  it('reads the top the wall would get under the roof as an edit would leave it', async () => {
    const { s, roofId, wallId } = await gableWall();
    const current = readFootprintRoofInStore(s.store, roofId, s.view);
    const flatter = Math.PI / 12;
    const profile = current && readRoofClippedWallTop(s.store, s.view, wallId, roofId, { ...current, EdgeSlopes: [flatter, 0, flatter, 0] });
    expect(Math.max(...(profile ?? []).map((p) => p.height))).toBeCloseTo(3 + 4 * Math.tan(flatter), 6);
    const steeper = current && readRoofClippedWallTop(s.store, s.view, wallId, roofId, { ...current, EdgeSlopes: [Math.PI / 4, 0, Math.PI / 4, 0] });
    expect(Math.max(...(steeper ?? []).map((p) => p.height))).toBeCloseTo(3 + 4, 6);
  });

  it('reads no top for a wall the roof does not cut', async () => {
    const s = await newStorey();
    const roofId = addRoofToStore(s.editor, s.anchor, { Position: [0, 0, 4], Width: 10, Depth: 8, Thickness: .25, EdgeSlopes: [SLOPE, 0, SLOPE, 0], Overhang: .5 }).roofId;
    const wallId = addWallToStore(s.editor, s.anchor, { Start: [5, 0, 0], End: [5, 8, 0], Height: 3, Thickness: .2 }).wallId;
    expect(readRoofClippedWallTop(s.store, s.view, wallId, roofId)).toBeNull();
  });
});
