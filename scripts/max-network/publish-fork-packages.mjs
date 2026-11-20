#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Publish the packages this fork changes to GitHub Packages as
 * `<scope>/<prefix><name>@<upstream version>-<prerelease>`, configured in
 * `.github/max-network-packages.json`. Each package is packed by pnpm (which
 * resolves `workspace:` ranges to the sibling versions), then only its name,
 * version, repository and publishConfig are rewritten: dependencies keep their
 * `@ifc-lite/*` names, so a consumer maps them with npm `overrides`. A version
 * the registry already has is skipped; releasing is bumping `prerelease`.
 *
 *   node scripts/max-network/publish-fork-packages.mjs [--packages=sdk,create] [--dry-run]
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const config = JSON.parse(readFileSync(join(root, '.github/max-network-packages.json'), 'utf8'));
const dryRun = process.argv.includes('--dry-run');
const requested = process.argv.find((arg) => arg.startsWith('--packages='))?.slice('--packages='.length);
const selected = requested ? requested.split(',').map((name) => name.trim()).filter(Boolean) : config.packages;

const unknown = selected.filter((name) => !config.packages.includes(name));
if (unknown.length) throw new Error(`Not configured in .github/max-network-packages.json: ${unknown.join(', ')}`);

const shell = process.platform === 'win32';
const run = (command, args, cwd) => execFileSync(command, args, { cwd, encoding: 'utf8', shell, stdio: ['ignore', 'pipe', 'pipe'] });

function isPublished(name, version) {
  try {
    run('npm', ['view', `${name}@${version}`, 'version', '--registry', config.registry], root);
    return true;
  } catch (error) {
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
    if (/E404|404 Not Found/.test(output)) return false;
    throw new Error(`Could not tell whether ${name}@${version} is published:\n${output}`);
  }
}

const results = [];
for (const dir of selected) {
  const packageDir = join(root, 'packages', dir);
  const source = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
  const name = `${config.scope}/${config.prefix}${source.name.split('/').pop()}`;
  const version = `${source.version}-${config.prerelease}`;
  if (!dryRun && isPublished(name, version)) {
    results.push(`${name}@${version} already published`);
    continue;
  }
  const work = mkdtempSync(join(tmpdir(), 'max-network-pack-'));
  try {
    run('pnpm', ['pack', '--pack-destination', work], packageDir);
    const tarball = readdirSync(work).find((file) => file.endsWith('.tgz'));
    if (!tarball) throw new Error(`pnpm pack wrote no tarball for ${source.name}`);
    run('tar', ['-xzf', tarball], work);
    const manifestPath = join(work, 'package', 'package.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const workspaceRange = Object.entries({ ...manifest.dependencies, ...manifest.peerDependencies })
      .find(([, range]) => String(range).startsWith('workspace:'));
    if (workspaceRange) throw new Error(`${source.name} still has ${workspaceRange[0]}@${workspaceRange[1]} after packing`);
    Object.assign(manifest, {
      name,
      version,
      repository: { type: 'git', url: `git+${config.repository}.git`, directory: `packages/${dir}` },
      homepage: `${config.repository}/tree/max-network/main/packages/${dir}`,
      bugs: `${config.repository}/issues`,
      publishConfig: { registry: config.registry },
    });
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    if (dryRun) {
      results.push(`${name}@${version} (dry run) dependencies ${JSON.stringify(manifest.dependencies ?? {})}`);
      continue;
    }
    run('npm', ['publish', '--registry', config.registry, '--tag', config.distTag], join(work, 'package'));
    results.push(`${name}@${version} published`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
console.log(results.join('\n'));
