/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { RandomSource } from '@ifc-lite/encoding';
import type { AlignGeometryProvider, RoomGeometryProvider } from '../index.js';

export interface HeadlessBackendOptions {
  /** Geometry preparation is supplied by a host; data-only consumers need no geometry runtime. */
  alignGeometry?: AlignGeometryProvider;
  roomGeometry?: { provide: RoomGeometryProvider; clear(): void };
  /**
   * Seeded randomness for every GlobalId this session authors, through
   * `bim.store.*` and the property sets `export.ifc` writes (a `Math.random`
   * style `() => number` in `[0, 1)`; see `SpatialAnchor.guidRandom`). The
   * same model, edits and seed then export byte-identical IFC. Omit it for the
   * platform CSPRNG; a seeded source trades global uniqueness for
   * reproducibility.
   */
  guidRandom?: RandomSource;
}

export function resolvedGeometryOptions(options: HeadlessBackendOptions): Required<Pick<HeadlessBackendOptions, 'alignGeometry' | 'roomGeometry'>> {
  return {
    alignGeometry: options.alignGeometry ?? (() => { throw new Error('Align requires a host geometry provider'); }),
    roomGeometry: options.roomGeometry ?? {
      provide: () => { throw new Error('Room requires a host geometry provider'); },
      clear() { /* No resources are allocated without a provider. */ },
    },
  };
}
