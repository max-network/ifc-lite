/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { ARC_CHORD_TOLERANCE } from '../arch/arch-shape.js';
import type { Pt2 } from '../arch/profile-path.js';
import { crossVaultGroins } from './vault-geometry.js';
import type { VaultDefinition } from './vault-definition.js';

export type PlanSegment = [Pt2, Pt2];

export interface VaultPlanLines {
  readonly outline: PlanSegment[];
  readonly crowns: PlanSegment[];
  readonly groins: Pt2[][];
}

export interface VaultPlanFrame extends Pick<VaultDefinition, 'Shape' | 'SpanAxis' | 'Width' | 'Depth' | 'Rise'> {
  readonly Origin: readonly [number, number];
  readonly XDirection: readonly [number, number];
}

export function vaultPlanLines(vault: VaultPlanFrame): VaultPlanLines {
  const length = Math.hypot(vault.XDirection[0], vault.XDirection[1]) || 1;
  const ux = vault.XDirection[0] / length, uy = vault.XDirection[1] / length;
  const at = (x: number, y: number): Pt2 => [vault.Origin[0] + ux * x - uy * y, vault.Origin[1] + uy * x + ux * y];
  const { Width: w, Depth: d } = vault;
  const corners = [at(0, 0), at(w, 0), at(w, d), at(0, d)];
  const outline = corners.map((corner, i): PlanSegment => [corner, corners[(i + 1) % 4]]);
  const alongX: PlanSegment = [at(0, d / 2), at(w, d / 2)];
  const alongY: PlanSegment = [at(w / 2, 0), at(w / 2, d)];
  if (vault.Shape === 'barrel') return { outline, crowns: [vault.SpanAxis === 'Y' ? alongX : alongY], groins: [] };
  const groins = crossVaultGroins(w, d, vault.Rise, ARC_CHORD_TOLERANCE).map((groin) => groin.map(([x, y]) => at(x, y)));
  return { outline, crowns: [alongX, alongY], groins };
}
