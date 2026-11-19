/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Usage: pnpm --filter @ifc-lite/drawing-2d parity:plan [outDir] [label]
import { spawnSync } from 'node:child_process';

const [outDir = '.parity/current', label = 'current'] = process.argv.slice(2);
const result = spawnSync('pnpm', ['exec', 'vitest', 'run', 'test/plan-parity.test.ts'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, PLAN_PARITY_OUT: outDir, PLAN_PARITY_LABEL: label },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
