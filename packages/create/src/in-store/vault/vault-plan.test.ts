/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { ARC_CHORD_TOLERANCE } from '../arch/arch-shape.js';
import { crossVaultGroins } from './vault-geometry.js';
import { vaultPlanLines } from './vault-plan.js';

const origin: [number, number] = [1, 2];
const east: [number, number] = [1, 0];
const base = { Width: 6, Depth: 4, Rise: 0.8, Thickness: 0.3, Origin: origin, XDirection: east };

describe('vaultPlanLines', () => {
  it('runs a barrel crown along its axis over the middle of its span, inside the dashed outline', () => {
    const lines = vaultPlanLines({ ...base, Shape: 'barrel', SpanAxis: 'Y' });
    expect(lines.outline).toHaveLength(4);
    expect(lines.crowns).toEqual([[[1, 4], [7, 4]]]);
    expect(lines.groins).toEqual([]);
    expect(vaultPlanLines({ ...base, Shape: 'barrel', SpanAxis: 'X' }).crowns).toEqual([[[4, 2], [4, 6]]]);
  });

  it('projects a cross vault\'s exact groin curves and both crowns from the same geometry as its body', () => {
    const lines = vaultPlanLines({ ...base, Shape: 'cross', SpanAxis: 'Y' });
    expect(lines.crowns).toHaveLength(2);
    const groins = crossVaultGroins(6, 4, 0.8, ARC_CHORD_TOLERANCE);
    expect(lines.groins).toEqual(groins.map((groin) => groin.map(([x, y]) => [x + 1, y + 2])));
  });

  it('turns with the vault: a north x axis lays the width along +y', () => {
    const lines = vaultPlanLines({ ...base, XDirection: [0, 1], Shape: 'barrel', SpanAxis: 'Y' });
    expect(lines.outline[0][1][0]).toBeCloseTo(1, 12);
    expect(lines.outline[0][1][1]).toBeCloseTo(8, 12);
  });
});
