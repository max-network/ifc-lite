/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** Writes the crafted corpus: the valid base model and one broken file per mutation, plus manifest.json. */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { baseRecords, serialize } from './base-model.js';
import { MUTATIONS } from './mutations.js';

const here = import.meta.dirname;
const broken = join(here, 'broken');
rmSync(broken, { recursive: true, force: true });
mkdirSync(broken, { recursive: true });
writeFileSync(join(here, 'base-ifc4.ifc'), serialize(baseRecords()));
const manifest = MUTATIONS.map((m) => {
  const records = baseRecords();
  const result = m.apply(records);
  writeFileSync(join(broken, `${m.name}.ifc`), serialize(records, result ? result.header : undefined));
  return { file: `broken/${m.name}.ifc`, targets: m.targets };
});
writeFileSync(join(here, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote base-ifc4.ifc and ${manifest.length} broken files`);
