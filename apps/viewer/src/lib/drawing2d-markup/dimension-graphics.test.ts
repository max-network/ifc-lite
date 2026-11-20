/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatDimensionValue } from './dimension-graphics.js';

describe('formatDimensionValue', () => {
  it('prints whole millimetres with no unit by default', () => {
    assert.equal(formatDimensionValue(4.2624), '4262');
    assert.equal(formatDimensionValue(4.2626), '4263');
    assert.equal(formatDimensionValue(0.0004), '0', 'never -0 or a fraction');
  });

  it('honours a viewer length unit override with its symbol', () => {
    const value = formatDimensionValue(4.2624, { LENGTHUNIT: 'm' });
    assert.ok(value.endsWith(' m'), `metre override, got ${value}`);
    assert.equal(Number.parseFloat(value.replace(',', '.')), 4.2624);
    assert.ok(formatDimensionValue(4.2624, { LENGTHUNIT: 'mm' }).endsWith(' mm'), 'mm override carries its symbol');
  });
});
