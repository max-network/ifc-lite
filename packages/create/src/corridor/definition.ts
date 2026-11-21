/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { CorridorDefinition, CorridorKerb, CrossFallSide } from './corridor.js';
import type { PlanXY } from './horizontal.js';
import type { CorridorPvi } from './profile.js';

type Fields = Record<string, unknown>;

const isFields = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value);
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const optionalNumber = (value: unknown): number | undefined | null => (value === undefined ? undefined : isNumber(value) ? value : null);
const SIDES: readonly CrossFallSide[] = ['camber', 'left', 'right'];
const isSide = (value: unknown): value is CrossFallSide => SIDES.some((side) => side === value);

function point(value: unknown): PlanXY | null {
  return Array.isArray(value) && value.length === 2 && isNumber(value[0]) && isNumber(value[1]) ? [value[0], value[1]] : null;
}

function pvi(value: unknown): CorridorPvi | null {
  if (!isFields(value) || !isNumber(value.Station)) return null;
  const [height, grade, curve] = [value.Height, value.Grade, value.CurveLength].map(optionalNumber);
  if (height === null || grade === null || curve === null) return null;
  return {
    Station: value.Station,
    ...(height === undefined ? {} : { Height: height }),
    ...(grade === undefined ? {} : { Grade: grade }),
    ...(curve === undefined ? {} : { CurveLength: curve }),
  };
}

function kerb(value: unknown): CorridorKerb | null | undefined {
  if (value === undefined) return undefined;
  return isFields(value) && isNumber(value.Height) && isNumber(value.Width) ? { Height: value.Height, Width: value.Width } : null;
}

function all<T>(values: readonly unknown[], read: (value: unknown) => T | null): T[] | null {
  const out: T[] = [];
  for (const value of values) {
    const item = read(value);
    if (item === null) return null;
    out.push(item);
  }
  return out;
}

/** A corridor definition read back from its recorded JSON, or null when it is not one. */
export function parseCorridorDefinition(text: unknown): CorridorDefinition | null {
  if (typeof text !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    console.warn('[corridor] unreadable definition', error);
    return null;
  }
  if (!isFields(parsed) || !Array.isArray(parsed.Centreline) || !Array.isArray(parsed.Profile)) return null;
  const centreline = all(parsed.Centreline, point);
  const profile = all(parsed.Profile, pvi);
  const radiiReadable = parsed.Radii === undefined || (Array.isArray(parsed.Radii) && parsed.Radii.every((r) => r === null || isNumber(r)));
  const kerbs = kerb(parsed.Kerb);
  const tolerance = optionalNumber(parsed.Tolerance);
  const { Width, CrossFall, CrossFallSide, MaxGrade, MinK } = parsed;
  if (!centreline || !profile || !radiiReadable || kerbs === null || tolerance === null) return null;
  if (!isNumber(Width) || !isNumber(CrossFall) || !isSide(CrossFallSide) || !isNumber(MaxGrade) || !isNumber(MinK)) return null;
  return {
    Centreline: centreline,
    Radii: Array.isArray(parsed.Radii) ? parsed.Radii.map((r) => (isNumber(r) ? r : null)) : [],
    Width, CrossFall, CrossFallSide, Profile: profile, MaxGrade, MinK,
    ...(kerbs ? { Kerb: kerbs } : {}),
    ...(tolerance === undefined ? {} : { Tolerance: tolerance }),
  };
}
