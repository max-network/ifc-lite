/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

// Runtimes that report `process.versions.node` without being Node (Cloudflare
// workerd, with or without nodejs_compat) cannot resolve `@xmldom/xmldom` at
// module evaluation. Importing the IDS parser must not load it: only a call
// that actually parses IDS without a global DOMParser may.
const xmldomLoads = vi.hoisted(() => ({ count: 0 }));
vi.mock('@xmldom/xmldom', async (importOriginal) => {
  xmldomLoads.count++;
  return importOriginal();
});

const MINIMAL_IDS = `<?xml version="1.0" encoding="UTF-8"?>
<ids xmlns="http://standards.buildingsmart.org/IDS" xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <info><title>Lazy fallback</title></info>
  <specifications>
    <specification name="Walls" ifcVersion="IFC4">
      <applicability><entity><name><simpleValue>IFCWALL</simpleValue></name></entity></applicability>
    </specification>
  </specifications>
</ids>`;

describe('parseIDS xmldom fallback', () => {
  it('does not load @xmldom/xmldom when the module is imported', async () => {
    expect('DOMParser' in globalThis).toBe(false);
    await import('./xml-parser.js');
    expect(xmldomLoads.count).toBe(0);
  });

  it('still parses IDS on Node without a global DOMParser', async () => {
    const { parseIDS } = await import('./xml-parser.js');
    const doc = parseIDS(MINIMAL_IDS);
    expect(doc.info.title).toBe('Lazy fallback');
    expect(doc.specifications).toHaveLength(1);
  });
});
