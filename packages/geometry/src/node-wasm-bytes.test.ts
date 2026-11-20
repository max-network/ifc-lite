/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { readNodeWasmBytes } from './node-wasm-bytes.js';

// Cloudflare workerd reports `process.versions.node` (with or without
// nodejs_compat) but cannot import Node built-ins without nodejs_compat. The
// geometry bridge must then fall back to wasm-bindgen's own init (which returns
// at once after a host's `initSync`), not fail importing `node:module`.
describe('readNodeWasmBytes', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads an installed package file on Node', async () => {
    const bytes = await readNodeWasmBytes('vitest/package.json', import.meta.url);
    expect(bytes).toBeInstanceOf(Uint8Array);
  });

  it('defers to wasm-bindgen where process.versions.node exists without Node built-ins', async () => {
    vi.stubGlobal('process', { versions: { node: '22.13.0' }, env: {} });
    await expect(readNodeWasmBytes('vitest/package.json', import.meta.url)).resolves.toBeUndefined();
  });

  it('defers to wasm-bindgen in a bundle that has Node built-ins but no file URL', async () => {
    const real = process;
    vi.stubGlobal('process', { versions: real.versions, env: {}, getBuiltinModule: real.getBuiltinModule.bind(real) });
    await expect(readNodeWasmBytes('vitest/package.json', undefined)).resolves.toBeUndefined();
    await expect(readNodeWasmBytes('vitest/package.json', 'worker.js')).resolves.toBeUndefined();
  });
});
