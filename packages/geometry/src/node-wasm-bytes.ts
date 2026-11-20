/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Under Node, read a wasm binary from an installed package; elsewhere return
 * `undefined` so wasm-bindgen resolves and fetches it itself. Node's fetch()
 * cannot load the file:// URL the generated glue derives from import.meta.url.
 * The built-ins come from `process.getBuiltinModule` (Node 20.16+/22.3+), so no
 * bundler resolves a Node-only module, and a runtime that reports
 * `process.versions.node` without Node built-ins (Cloudflare workerd without
 * nodejs_compat) takes the wasm-bindgen path instead of failing an import.
 * A bundle that exposes the built-ins but was not loaded from a file (workerd
 * leaves `import.meta.url` undefined) has no installed package to read either.
 * Untyped on purpose: this package has no @types/node.
 */

type NodeModule = { createRequire(path: string): { resolve(id: string): string } };
type NodeFs = { readFile(path: string): Promise<Uint8Array> };
type NodeProcess = {
  versions?: { node?: string };
  getBuiltinModule?: (id: string) => unknown;
};

export async function readNodeWasmBytes(specifier: string, moduleUrl: string | undefined): Promise<BufferSource | undefined> {
  const proc = (globalThis as { process?: NodeProcess }).process;
  if (!proc?.versions?.node || typeof window !== 'undefined' || typeof proc.getBuiltinModule !== 'function') return undefined;
  if (typeof moduleUrl !== 'string' || !moduleUrl.startsWith('file:')) return undefined;
  const nodeModule = proc.getBuiltinModule('node:module') as NodeModule | undefined;
  const nodeFs = proc.getBuiltinModule('node:fs/promises') as NodeFs | undefined;
  if (!nodeModule || !nodeFs) return undefined;
  const path = nodeModule.createRequire(moduleUrl).resolve(specifier);
  return (await nodeFs.readFile(path)) as BufferSource;
}
