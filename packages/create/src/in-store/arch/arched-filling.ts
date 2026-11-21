/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { doorLayout, windowLayout, type FillingRect } from '../filling-layout.js';
import { GLAZING_THICKNESS, HANDLE_PROJECTION, LEAF_THICKNESS, type FillingBodySpec, type FillingPartRole, type PartSpec } from '../filling-body.js';
import { archedFramePath, archedOpeningPath, archedRingPaths, rectUnderArch, type ArchedHead } from './arched-outline.js';

function clipped(role: FillingPartRole, rect: FillingRect, head: ArchedHead, inset: number, depth: number): PartSpec[] {
  const outer = rectUnderArch(rect, head, inset);
  return outer ? [{ role, shape: { kind: 'path', outer, voids: [] }, depth }] : [];
}

export function archedParts(spec: FillingBodySpec, lining: number, depth: number, rise: number): PartSpec[] {
  const head: ArchedHead = { width: spec.Width, height: spec.Height, rise };
  if (spec.Detail === 'box') return [{ role: 'lining', shape: { kind: 'path', outer: archedOpeningPath(head), voids: [] }, depth }];
  if (spec.kind === 'window') {
    const layout = windowLayout(spec.PartitioningType, spec.Width, spec.Height, lining);
    const ring = archedRingPaths(head, layout.lining);
    const glass = Math.min(GLAZING_THICKNESS, depth * 0.6);
    return [
      { role: 'lining', shape: { kind: 'path', outer: ring.outer, voids: [ring.inner] }, depth },
      ...layout.bars.flatMap((bar) => clipped('mullion', bar, head, layout.lining, depth)),
      ...layout.panes.flatMap((pane) => clipped('glazing', pane, head, layout.lining, glass)),
    ];
  }
  const layout = doorLayout(spec.OperationType, spec.Width, spec.Height, lining, spec.Handle ?? true);
  const leaf = Math.min(LEAF_THICKNESS, depth * 0.8);
  const gap = layout.leaves.length ? layout.leaves[0].x0 - (layout.lining - spec.Width / 2) : 0;
  return [
    { role: 'lining', shape: { kind: 'path', outer: archedFramePath(head, layout.lining), voids: [] }, depth },
    ...layout.leaves.flatMap((rect) => clipped('leaf', rect, head, layout.lining + gap, leaf)),
    ...layout.handles.map((rect): PartSpec => ({ role: 'handle', shape: { kind: 'rect', rect }, depth: leaf + 2 * HANDLE_PROJECTION })),
  ];
}
