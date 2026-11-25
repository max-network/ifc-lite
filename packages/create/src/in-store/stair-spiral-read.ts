/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { MutablePropertyView } from '@ifc-lite/mutations';
import type { IfcDataStore } from '@ifc-lite/parser';
import { axis3d, pointOf, refId, type GeometryEntityReader, type Vec3 } from './host-geometry-frame.js';
import { safeLengthUnitScale } from './length-unit-scale.js';
import { AnchorEntityReader } from './resolve-anchor.js';
import type { SpiralStairInStoreParams } from './stair-spiral.js';

export interface SpiralStairRead extends SpiralStairInStoreParams {
  readonly stairId: number;
  readonly flightId: number;
}

interface TreadRead {
  inner: number;
  outer: number;
  low: number;
  high: number;
  thickness: number;
}

const TAU = 2 * Math.PI;

function measure(value: unknown): number | null {
  const raw = typeof value === 'object' && value !== null && 'real' in value ? value.real : value;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

function wrapped(angle: number): number {
  const turned = ((angle % TAU) + TAU) % TAU;
  return turned > Math.PI ? turned - TAU : turned;
}

function curvePoints(reader: GeometryEntityReader, curveId: number | null): Vec3[] | null {
  const curve = curveId === null ? null : reader.entity(curveId);
  const type = curve?.type.toUpperCase();
  if (type === 'IFCPOLYLINE' && Array.isArray(curve?.attributes[0])) {
    const points = curve.attributes[0].map((ref) => pointOf(reader, ref, 'IFCCARTESIANPOINT', 2));
    return points.every((point) => point !== null) ? points.flatMap((point) => (point ? [point] : [])) : null;
  }
  if (type !== 'IFCINDEXEDPOLYCURVE') return null;
  const listId = refId(curve?.attributes[0]);
  const list = listId === null ? null : reader.entity(listId)?.attributes[0];
  if (!Array.isArray(list)) return null;
  const points = list.map((value): Vec3 | null => {
    const x = Array.isArray(value) ? measure(value[0]) : null;
    const y = Array.isArray(value) ? measure(value[1]) : null;
    return x === null || y === null ? null : [x, y, 0];
  });
  return points.every((point) => point !== null) ? points.flatMap((point) => (point ? [point] : [])) : null;
}

function extrusion(reader: GeometryEntityReader, solidId: number | null): { points: Vec3[]; base: number; depth: number } | null {
  const solid = solidId === null ? null : reader.entity(solidId);
  if (solid?.type.toUpperCase() !== 'IFCEXTRUDEDAREASOLID') return null;
  const depth = measure(solid.attributes[3]);
  const frame = axis3d(reader, solid.attributes[1]);
  const direction = pointOf(reader, solid.attributes[2], 'IFCDIRECTION');
  const profileId = refId(solid.attributes[0]);
  const profile = profileId === null ? null : reader.entity(profileId);
  if (depth === null || depth <= 0 || !frame || !direction || Math.abs(direction[2] - 1) > 1e-9 || Math.abs(frame.z[2] - 1) > 1e-9) return null;
  if (profile?.type.toUpperCase() !== 'IFCARBITRARYCLOSEDPROFILEDEF') return null;
  const points = curvePoints(reader, refId(profile.attributes[2]));
  return points && points.length >= 3 ? { points: points.map(([x, y]): Vec3 => [frame.o[0] + x, frame.o[1] + y, 0]), base: frame.o[2], depth } : null;
}

function tread(reader: GeometryEntityReader, solidId: number | null): TreadRead | null {
  const body = extrusion(reader, solidId);
  if (!body) return null;
  const [start, outerStart] = body.points;
  const low = Math.atan2(start[1], start[0]);
  const spans = body.points.map(([x, y]) => wrapped(Math.atan2(y, x) - low));
  const high = low + Math.max(...spans);
  if (Math.min(...spans) < -1e-9 || high - low <= 0) return null;
  return { inner: Math.hypot(start[0], start[1]), outer: Math.hypot(outerStart[0], outerStart[1]), low, high, thickness: body.depth };
}

function flightOf(reader: AnchorEntityReader, stairId: number): number | null {
  const members: number[] = [];
  for (const relId of reader.ids('IFCRELAGGREGATES')) {
    const rel = reader.entity(relId);
    const related = rel?.attributes[5];
    if (refId(rel?.attributes[4]) !== stairId || !Array.isArray(related)) continue;
    members.push(...related.flatMap((value) => refId(value) ?? []));
  }
  return members.length === 1 && reader.entity(members[0])?.type.toUpperCase() === 'IFCSTAIRFLIGHT' ? members[0] : null;
}

function bodyItems(reader: GeometryEntityReader, productShape: unknown): number[] | null {
  const shapeId = refId(productShape);
  const reps = shapeId === null ? null : reader.entity(shapeId)?.attributes[2];
  if (!Array.isArray(reps) || reps.length !== 1) return null;
  const repId = refId(reps[0]);
  const rep = repId === null ? null : reader.entity(repId);
  const items = rep?.attributes[3];
  if (rep?.attributes[1] !== 'Body' || !Array.isArray(items)) return null;
  const ids = items.map((item) => refId(item));
  return ids.every((id) => id !== null) ? ids.flatMap((id) => id ?? []) : null;
}

export function readSpiralStair(store: IfcDataStore, stairId: number, view?: MutablePropertyView | null): SpiralStairRead | null {
  const reader = new AnchorEntityReader(store, view);
  const stair = reader.entity(stairId);
  if (stair?.type.toUpperCase() !== 'IFCSTAIR' || String(stair.attributes[8]).replace(/\./g, '') !== 'SPIRAL_STAIR') return null;
  const flightId = flightOf(reader, stairId);
  const flight = flightId === null ? null : reader.entity(flightId);
  if (flightId === null || !flight) return null;
  const attribute = (name: string) => flight.attributes[flight.names.indexOf(name)];
  const risers = measure(attribute(store.schemaVersion === 'IFC2X3' ? 'NumberOfRiser' : 'NumberOfRisers'));
  const riser = measure(attribute('RiserHeight'));
  const going = measure(attribute('TreadLength'));
  const items = bodyItems(reader, flight.attributes[6]);
  if (risers === null || !Number.isInteger(risers) || risers < 2 || riser === null || going === null || !items || items.length !== risers + 1) return null;
  const newel = extrusion(reader, items[0]);
  const treads = items.slice(1).map((id) => tread(reader, id));
  const [first, second] = treads;
  if (!newel || !first || !second || treads.some((entry) => entry === null)) return null;
  const placementId = refId(stair.attributes[5]);
  const placement = placementId === null ? null : reader.entity(placementId);
  const frame = placement?.type.toUpperCase() === 'IFCLOCALPLACEMENT' ? axis3d(reader, placement.attributes[1]) : null;
  const scale = safeLengthUnitScale(store.source, store.entityIndex, 'readSpiralStair');
  if (!frame || scale === null) return null;
  const turn = wrapped((second.low + second.high) / 2 - (first.low + first.high) / 2) < 0 ? 'cw' : 'ccw';
  const treadAngle = first.high - first.low;
  const startLocal = turn === 'ccw' ? first.low : first.high;
  return {
    stairId,
    flightId,
    Centre: [frame.o[0] * scale, frame.o[1] * scale, frame.o[2] * scale],
    OuterRadius: first.outer * scale,
    NewelRadius: Math.hypot(newel.points[0][0], newel.points[0][1]) * scale,
    StartAngle: wrapped(Math.atan2(frame.x[1], frame.x[0]) + startLocal),
    Turn: turn,
    NumberOfRisers: risers,
    RiserHeight: riser * scale,
    TreadAngle: treadAngle,
    WalkingLineRadius: (going / treadAngle) * scale,
    TreadThickness: first.thickness * scale,
  };
}
