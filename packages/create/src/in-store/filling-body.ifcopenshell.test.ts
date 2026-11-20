/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Detailed doors and windows export schema-conformant per IfcOpenShell
 * (`tools/ifcopenshell_reference/validate_export.py`, express rules on), in
 * every schema hosted placement supports, before and after a resize. Needs a
 * Python with `ifcopenshell` (`IFCOPENSHELL_PYTHON` or `python3`); skips
 * loudly without one.
 */

import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { IfcParser } from '@ifc-lite/parser';
import { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import { StepExporter } from '@ifc-lite/export';
import { IfcCreator } from '../ifc-creator.js';
import { resolveSpatialAnchor } from './resolve-anchor.js';
import { addWallToStore } from './wall.js';
import { addHostedElementInStore } from './hosted-element.js';
import { editHostedElementInStore } from './hosted-element-edit.js';

const VALIDATE_SCRIPT = resolve(__dirname, '../../../../tools/ifcopenshell_reference/validate_export.py');
const PYTHON = process.env.IFCOPENSHELL_PYTHON || 'python3';
const canRun = spawnSync(PYTHON, ['-c', 'import ifcopenshell, ifcopenshell.validate'], { stdio: 'ignore' }).status === 0;
if (!canRun) console.warn(`[filling-body.ifcopenshell] SKIPPED: ifcopenshell not importable via "${PYTHON}"`);

async function exported(schema: 'IFC2X3' | 'IFC4' | 'IFC4X3', resize: boolean): Promise<string> {
  const creator = new IfcCreator({ Schema: schema, Timestamp: 0 });
  const storey = creator.addIfcBuildingStorey({ Name: 'GF', Elevation: 0 });
  const store = await new IfcParser().parseColumnar(new TextEncoder().encode(creator.toIfc().content).buffer, { disableWorkerScan: true });
  const view = new MutablePropertyView(null, 'm'), editor = new StoreEditor(store, view);
  const wall = addWallToStore(editor, resolveSpatialAnchor(store, storey, view), { Start: [0, 0, 0], End: [8, 0, 0], Height: 3, Thickness: 0.24 }).wallId;
  const window = addHostedElementInStore(store, editor, wall, { kind: 'window', params: { Offset: 2, Sill: 0.9, Width: 1.2, Height: 1.4, PartitioningType: 'TRIPLE_PANEL_TOP' } }).expressId;
  addHostedElementInStore(store, editor, wall, { kind: 'door', params: { Offset: 5, Width: 1.6, Height: 2.1, OperationType: 'DOUBLE_DOOR_SINGLE_SWING' } });
  if (resize) editHostedElementInStore(store, editor, window, { OverallWidth: 1.5, OverallHeight: 1.2 });
  return new TextDecoder().decode(new StepExporter(store, view).export({ schema, applyMutations: true }).content);
}

describe.skipIf(!canRun)('detailed fillings validate per IfcOpenShell', () => {
  for (const schema of ['IFC2X3', 'IFC4', 'IFC4X3'] as const) for (const resize of [false, true]) {
    it(`${schema}${resize ? ' after a resize' : ''}`, async () => {
      const content = await exported(schema, resize);
      expect(content).toContain('IFCRECTANGLEHOLLOWPROFILEDEF(');
      const path = join(mkdtempSync(join(tmpdir(), 'ifc-lite-fillings-')), `${schema}.ifc`);
      writeFileSync(path, content);
      const run = spawnSync(PYTHON, [VALIDATE_SCRIPT, path], { encoding: 'utf8' });
      expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
    }, 120_000);
  }
});
