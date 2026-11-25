/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export type CorridorProblemCode =
  | 'width'
  | 'centreline'
  | 'radius_too_large'
  | 'radius_below_half_width'
  | 'transition_too_long'
  | 'self_intersecting'
  | 'station_outside'
  | 'stations_not_ascending'
  | 'missing_height'
  | 'grade_too_steep'
  | 'curve_too_short'
  | 'curve_does_not_fit';

/** One reason a corridor cannot be built, with the numbers that explain it (metres, rise/run). */
export interface CorridorProblem {
  code: CorridorProblemCode;
  /** Index of the centreline vertex concerned. */
  vertex?: number;
  /** Station concerned, metres along the centreline. */
  station?: number;
  values: Record<string, number>;
}

export class CorridorRefusal extends Error {
  readonly problems: readonly CorridorProblem[];

  constructor(problems: readonly CorridorProblem[]) {
    super(`corridor refused: ${problems.map((p) => p.code).join(', ')}`);
    this.name = 'CorridorRefusal';
    this.problems = problems;
  }
}
