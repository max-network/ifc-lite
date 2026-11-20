/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { QuantityType } from '@ifc-lite/data';
import { ProjectUnits } from '@ifc-lite/parser';
import { resolveQuantityDisplay, formatConverted } from '@/lib/units/display';

const EMPTY_UNITS = ProjectUnits.empty();

/**
 * The value a dimension prints: whole millimetres with no unit (4.2624 m reads
 * `4262`) unless the viewer has a length display unit set, which then applies
 * with its symbol (`4.2624 m`). Drawing distances are already metres, so the
 * file's declared unit never rescales them.
 */
export function formatDimensionValue(metres: number, unitDisplayOverrides: Record<string, string> = {}): string {
  const disp = resolveQuantityDisplay(metres, QuantityType.Length, EMPTY_UNITS, unitDisplayOverrides);
  if (disp.converted === null) return String(Math.round(metres * 1000) + 0);
  const formatted = formatConverted(disp.converted);
  return disp.unit ? `${formatted} ${disp.unit}` : formatted;
}
