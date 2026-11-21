/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import {
  assembleProfile, checkProfile, curveSegments, evaluateVertical,
  type ProfileVertex, type VerticalSegment,
} from '../landxml/profile-geometry.js';
import type { LandXmlIfcVerticalCurve } from '../landxml/profile-record.js';
import type { CorridorProblem } from './problems.js';

/** A point of intersection of two grades: a height, or the grade (rise/run) arriving from the previous point. */
export interface CorridorPvi {
  Station: number;
  Height?: number;
  Grade?: number;
  /** Horizontal length of the parabolic vertical curve rounding this point off. */
  CurveLength?: number;
}

export interface ProfileLimits {
  /** Steepest grade allowed, rise/run. */
  maxGrade: number;
  /** Minimum K value: metres of vertical curve per 1 % of grade change. */
  minK: number;
}

export interface ProfileGrade {
  from: number;
  to: number;
  grade: number;
}

export interface ProfileCurve {
  pvi: number;
  start: number;
  length: number;
  gradeIn: number;
  gradeOut: number;
  /** Metres per 1 % of grade change. */
  k: number;
}

export interface CorridorProfileResult {
  segments: VerticalSegment[];
  pvis: ProfileVertex[];
  grades: ProfileGrade[];
  curves: ProfileCurve[];
  problems: CorridorProblem[];
}

const PERCENT = 100;
const GRADE_EPS = 1e-9;
const STATION_EPS = 1e-9;

/** Height and gradient at station `s`, clamped to the profile. */
export function profileAt(segments: readonly VerticalSegment[], s: number): { height: number; gradient: number } {
  const first = segments[0];
  if (!first) throw new Error('profileAt: the profile has no segments');
  for (const segment of segments) {
    if (s <= segment.startDistAlong + segment.horizontalLength) {
      return evaluateVertical(segment, Math.min(Math.max(s - segment.startDistAlong, 0), segment.horizontalLength));
    }
  }
  const last = segments[segments.length - 1];
  return evaluateVertical(last, last.horizontalLength);
}

function resolveHeights(profile: readonly CorridorPvi[], problems: CorridorProblem[]): ProfileVertex[] {
  const vertices: ProfileVertex[] = [];
  profile.forEach((point, i) => {
    const previous = vertices[i - 1];
    const height = point.Height ?? (previous && point.Grade !== undefined ? previous.height + point.Grade * (point.Station - previous.distAlong) : undefined);
    if (height === undefined) {
      problems.push({ code: 'missing_height', station: point.Station, values: {} });
      return;
    }
    vertices.push({ sourceId: `pvi:${i}`, distAlong: point.Station, height });
  });
  return vertices;
}

function extendToEnds(vertices: readonly ProfileVertex[], length: number): ProfileVertex[] {
  if (vertices.length === 1) {
    const [only] = vertices;
    const ends = [{ ...only, sourceId: 'start', distAlong: 0 }, { ...only, sourceId: 'end', distAlong: length }];
    return only.distAlong <= STATION_EPS ? [only, ends[1]] : only.distAlong >= length - STATION_EPS ? [ends[0], only] : [ends[0], only, ends[1]];
  }
  const out = [...vertices];
  const [a, b] = out;
  if (a.distAlong > STATION_EPS) {
    const g = (b.height - a.height) / (b.distAlong - a.distAlong);
    out.unshift({ sourceId: 'start', distAlong: 0, height: a.height - g * a.distAlong });
  }
  const y = out[out.length - 1];
  const x = out[out.length - 2];
  if (y.distAlong < length - STATION_EPS) {
    const g = (y.height - x.height) / (y.distAlong - x.distAlong);
    out.push({ sourceId: 'end', distAlong: length, height: y.height + g * (length - y.distAlong) });
  }
  return out;
}

/**
 * Grades between the points of intersection and a symmetric parabolic
 * vertical curve at each grade change, z(x) = z_BVC + g1·x + (g2 − g1)·x²/(2L),
 * of length L = K·|g2 − g1| (in %) unless a longer one is given.
 */
export function corridorProfile(profile: readonly CorridorPvi[], length: number, limits: ProfileLimits): CorridorProfileResult {
  const problems: CorridorProblem[] = [];
  const empty = (): CorridorProfileResult => ({ segments: [], pvis: [], grades: [], curves: [], problems });
  if (profile.length === 0) {
    problems.push({ code: 'missing_height', station: 0, values: {} });
    return empty();
  }
  profile.forEach((point, i) => {
    if (point.Station < -STATION_EPS || point.Station > length + STATION_EPS) problems.push({ code: 'station_outside', station: point.Station, values: { length } });
    const previous = profile[i - 1];
    if (previous && point.Station <= previous.Station + STATION_EPS) problems.push({ code: 'stations_not_ascending', station: point.Station, values: { previous: previous.Station } });
  });
  if (problems.length > 0) return empty();
  const authored = resolveHeights(profile, problems);
  if (problems.length > 0) return empty();
  const vertices = extendToEnds(authored, length);
  const offset = vertices[0] === authored[0] ? 0 : 1;

  const grades: ProfileGrade[] = vertices.slice(1).map((b, i) => {
    const a = vertices[i];
    return { from: a.distAlong, to: b.distAlong, grade: (b.height - a.height) / (b.distAlong - a.distAlong) };
  });
  grades.forEach((g) => {
    if (Math.abs(g.grade) > limits.maxGrade + GRADE_EPS) problems.push({ code: 'grade_too_steep', station: g.from, values: { grade: g.grade, maxGrade: limits.maxGrade } });
  });

  const lengths = vertices.map((vertex, i) => {
    const before = grades[i - 1];
    const after = grades[i];
    if (!before || !after) return 0;
    const change = Math.abs(after.grade - before.grade);
    if (change <= GRADE_EPS) return 0;
    const minLength = limits.minK * change * PERCENT;
    const given = profile[i - offset]?.CurveLength;
    if (given !== undefined && given < minLength - STATION_EPS) {
      problems.push({ code: 'curve_too_short', station: vertex.distAlong, values: { length: given, minLength } });
    }
    return given ?? minLength;
  });
  lengths.forEach((curve, i) => {
    if (curve === 0) return;
    const back = vertices[i].distAlong - vertices[i - 1].distAlong - lengths[i - 1] / 2;
    const ahead = vertices[i + 1].distAlong - vertices[i].distAlong - lengths[i + 1] / 2;
    const room = 2 * Math.min(back, ahead);
    if (curve > room + STATION_EPS) problems.push({ code: 'curve_does_not_fit', station: vertices[i].distAlong, values: { length: curve, room: Math.max(0, room) } });
  });
  if (problems.length > 0) return { ...empty(), pvis: vertices, grades: mergeGrades(grades) };

  const curves: ProfileCurve[] = [];
  const pieces = vertices.map((vertex, i) => {
    if (lengths[i] === 0) return [];
    const gradeIn = grades[i - 1].grade;
    const gradeOut = grades[i].grade;
    const record: LandXmlIfcVerticalCurve = { sourceId: `curve:${i}`, kind: 'parabolic', station: vertex.distAlong, elevation: vertex.height, length: lengths[i], lengthIn: null, lengthOut: null, radius: null };
    const made = curveSegments(record, vertex, gradeIn, gradeOut, { linearScaleToMeters: 1, elevationScaleToMeters: 1 }, `the vertical curve at ${vertex.distAlong} m`);
    if (made.length > 0) {
      curves.push({ pvi: vertex.distAlong, start: vertex.distAlong - lengths[i] / 2, length: lengths[i], gradeIn, gradeOut, k: lengths[i] / (Math.abs(gradeOut - gradeIn) * PERCENT) });
    }
    return made;
  });
  const segments = assembleProfile('profile', vertices, pieces);
  checkProfile(segments, vertices, pieces);
  return { segments, pvis: vertices, grades: mergeGrades(grades), curves, problems };
}

function mergeGrades(grades: readonly ProfileGrade[]): ProfileGrade[] {
  const merged: ProfileGrade[] = [];
  for (const grade of grades) {
    const previous = merged[merged.length - 1];
    if (previous && Math.abs(previous.grade - grade.grade) <= GRADE_EPS) merged[merged.length - 1] = { ...previous, to: grade.to };
    else merged.push({ ...grade });
  }
  return merged;
}
