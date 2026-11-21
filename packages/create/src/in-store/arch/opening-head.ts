/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { IfcDataStore } from '@ifc-lite/parser';
import type { MutablePropertyView } from '@ifc-lite/mutations';
import { fromNativeLength } from '../anchor.js';
import { refId } from '../host-geometry-frame.js';
import { safeLengthUnitScale } from '../length-unit-scale.js';
import { AnchorEntityReader } from '../resolve-anchor.js';

export type OpeningHead = { readonly Shape: 'round' } | { readonly Shape: 'segmental'; readonly Rise: number };

const ROUND_TOLERANCE = 1e-6;

export function headRise(head: OpeningHead, width: number, height: number, op: string): number {
  const half = width / 2;
  if (head.Shape === 'round') {
    if (half > height + ROUND_TOLERANCE * width) throw new Error(`${op}: a round head needs at least half the width (${half}) of height; the opening is ${height} high`);
    return half;
  }
  if (head.Shape !== 'segmental') throw new Error(`${op}: Head.Shape must be round or segmental`);
  const rise = head.Rise;
  if (!Number.isFinite(rise) || rise <= 0) throw new Error(`${op}: a segmental head needs a positive Rise`);
  if (rise > half + ROUND_TOLERANCE * width) throw new Error(`${op}: the arch rise ${rise} is larger than half the width (${half})`);
  if (rise > height) throw new Error(`${op}: the arch rise ${rise} is larger than the opening height ${height}`);
  return Math.min(rise, half);
}

export function headOf(rise: number, width: number): OpeningHead {
  return Math.abs(rise - width / 2) <= ROUND_TOLERANCE * width ? { Shape: 'round' } : { Shape: 'segmental', Rise: rise };
}

function profileCurve(reader: AnchorEntityReader, productId: number): number | null {
  const shapeId = refId(reader.entity(productId)?.attributes[6]);
  const reps = shapeId === null ? null : reader.entity(shapeId)?.attributes[2];
  if (!Array.isArray(reps)) return null;
  for (const value of reps) {
    const items = reader.entity(refId(value) ?? -1)?.attributes[3];
    if (!Array.isArray(items) || items.length !== 1) continue;
    const solid = reader.entity(refId(items[0]) ?? -1);
    if (solid?.type.toUpperCase() !== 'IFCEXTRUDEDAREASOLID') continue;
    const profile = reader.entity(refId(solid.attributes[0]) ?? -1);
    if (profile?.type.toUpperCase() === 'IFCARBITRARYCLOSEDPROFILEDEF') return refId(profile.attributes[2]);
  }
  return null;
}

function arcIndices(segments: unknown): number[][] {
  if (!Array.isArray(segments)) return [];
  return segments.flatMap((segment) => {
    const [type, value] = typedPair(segment);
    return type === 'IFCARCINDEX' && Array.isArray(value) && value.length === 3 && value.every((i) => typeof i === 'number') ? [value.map(Number)] : [];
  });
}

function typedPair(segment: unknown): [unknown, unknown] {
  if (Array.isArray(segment) && segment.length === 2) return [segment[0], segment[1]];
  if (typeof segment !== 'object' || segment === null || !('typed' in segment)) return [null, null];
  const typed = segment.typed;
  if (typeof typed !== 'object' || typed === null || !('type' in typed) || !('value' in typed)) return [null, null];
  return [typed.type, typed.value];
}

export interface ReadOpeningHead {
  readonly head: OpeningHead;
  readonly rise: number;
}

export function readOpeningHead(store: IfcDataStore, openingId: number, view?: MutablePropertyView | null): ReadOpeningHead | null {
  const reader = new AnchorEntityReader(store, view);
  const curve = reader.entity(profileCurve(reader, openingId) ?? -1);
  if (curve?.type.toUpperCase() !== 'IFCINDEXEDPOLYCURVE') return null;
  const coords = reader.entity(refId(curve.attributes[0]) ?? -1)?.attributes[0];
  const arcs = arcIndices(curve.attributes[1]);
  if (!Array.isArray(coords) || arcs.length === 0) return null;
  const point = (index: number): [number, number] | null => {
    const p = coords[index - 1];
    return Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number' ? [p[0], p[1]] : null;
  };
  const ends = arcs.flatMap((arc) => [point(arc[0]), point(arc[2])]);
  const tops = arcs.flatMap((arc) => [point(arc[0]), point(arc[1]), point(arc[2])]);
  if (ends.some((p) => p === null) || tops.some((p) => p === null)) return null;
  const xs = ends.flatMap((p) => (p ? [p[0]] : []));
  const crown = Math.max(...tops.flatMap((p) => (p ? [p[1]] : [])));
  const springing = Math.min(...ends.flatMap((p) => (p ? [p[1]] : [])));
  const width = Math.max(...xs) - Math.min(...xs);
  const scale = store.source.byteLength > 0 ? safeLengthUnitScale(store.source, store.entityIndex, 'readOpeningHead') ?? 1 : 1;
  const rise = fromNativeLength({ lengthUnitScale: scale }, crown - springing);
  if (!(rise > 0) || !(width > 0)) return null;
  return { head: headOf(rise, fromNativeLength({ lengthUnitScale: scale }, width)), rise };
}
