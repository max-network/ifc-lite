/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Floor plan parity on real models: every storey of each fixture is drawn two
 * ways and measured against the sheet-quality goals.
 *
 *  - `generateFloorPlan`: the one-liner a caller writes today (all meshes, cut
 *    at storey elevation + 1.2 in the render frame, default SVG export).
 *  - `generateStoreyPlan`: the storey-aware sheet entry point.
 *
 * Set `PLAN_PARITY_OUT=<dir>` to write `plan-parity.md`/`.json` and the SVGs.
 * The new entry point is looked up at runtime, so this file also measures a
 * library version that predates it (its rows are then skipped).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { totalYupOffset } from '@ifc-lite/geometry/world-frame';
import * as drawing2d from '../src/index.js';
import { generateFloorPlan, exportToSVG } from '../src/index.js';
import { loadPlanFixture, wasmAvailable, type PlanFixture } from './plan-parity/fixture.js';
import { measurePlan, type PlanMetrics } from './plan-parity/metrics.js';
import { writeReport } from './plan-parity/report.js';
import { measureDimensions, type DimensionMetrics } from './plan-parity/dimension-metrics.js';

const CUT_HEIGHT = 1.2;
const repo = (path: string) => fileURLToPath(new URL(`../../../${path}`, import.meta.url));
const FIXTURES: Array<{ name: string; path: string; required: boolean }> = [
  { name: 'AC20-FZK-Haus', path: repo('apps/viewer/public/_fixtures/AC20-FZK-Haus.ifc'), required: true },
  { name: 'building-architecture', path: repo('apps/viewer/public/samples/building-architecture.ifc'), required: true },
  { name: 'MiniBIM-georeferenced', path: repo('tests/models/georeferencer/MiniBIM-3.1-DO_01_VORM.ifc'), required: false },
];

if (!wasmAvailable) console.warn('Plan parity skipped: the wasm runtime is not built (scripts/build-wasm.sh or pnpm build:wasm:fetch).');

const rows: PlanMetrics[] = [];
const dimensionRows: (DimensionMetrics & { fixture: string; storey: string })[] = [];
const svgs = new Map<string, string>();
const fixtures: PlanFixture[] = [];

async function measureFixture(fixture: PlanFixture): Promise<void> {
  const offsetY = totalYupOffset(fixture.frame).y;
  const materialCategories = new Map<number, drawing2d.MaterialCategory>();
  if ('classifyMaterialName' in drawing2d) {
    for (const [id, name] of fixture.materialNames) {
      const category = drawing2d.classifyMaterialName(name);
      if (category) materialCategories.set(id, category);
    }
  }
  for (const storey of fixture.storeys) {
    const slug = `${fixture.name}-${storey.name}`.replace(/[^A-Za-z0-9_-]+/g, '_');
    const legacy = await generateFloorPlan(fixture.meshes, storey.elevation + CUT_HEIGHT, { useGPU: false });
    const legacySvg = exportToSVG(legacy);
    rows.push(measurePlan(fixture, storey, 'generateFloorPlan', legacy, legacySvg, offsetY, CUT_HEIGHT));
    svgs.set(`${slug}-generateFloorPlan`, legacySvg);

    if (!('generateStoreyPlan' in drawing2d)) continue;
    const plan = await drawing2d.generateStoreyPlan(fixture.meshes, {
      storeyElevation: storey.elevation,
      storeyHeight: storey.height,
      cutHeight: CUT_HEIGHT,
      frame: fixture.frame,
      openings: fixture.openings,
      storeyElements: storey.elements,
      spaces: { labels: fixture.spaceLabels },
      dimensions: {},
      generator: { useGPU: false },
    });
    dimensionRows.push({ fixture: fixture.name, storey: storey.name, ...measureDimensions(plan, storey.elements) });
    const planSvg = exportToSVG(plan, { materialCategories });
    rows.push(measurePlan(fixture, storey, 'generateStoreyPlan', plan, planSvg, offsetY, CUT_HEIGHT));
    svgs.set(`${slug}-generateStoreyPlan`, planSvg);
  }
}

describe.skipIf(!wasmAvailable)('floor plan parity on real models', () => {
  beforeAll(async () => {
    for (const { name, path, required } of FIXTURES) {
      if (!existsSync(path)) {
        if (required) throw new Error(`committed fixture missing: ${path}`);
        console.warn(`Plan parity: ${name} absent, run pnpm fixtures to include it.`);
        continue;
      }
      const fixture = await loadPlanFixture(name, path);
      fixtures.push(fixture);
      await measureFixture(fixture);
    }
  }, 300_000);

  afterAll(() => {
    const out = process.env.PLAN_PARITY_OUT;
    if (out && rows.length > 0) writeReport(out, rows, process.env.PLAN_PARITY_LABEL ?? 'current', svgs);
  });

  const sheetRows = () => rows.filter((r) => r.pipeline === 'generateStoreyPlan');

  it('measures every storey of the committed fixtures', () => {
    expect(fixtures.map((f) => f.name)).toEqual(expect.arrayContaining(['AC20-FZK-Haus', 'building-architecture']));
    expect(sheetRows().length).toBe(fixtures.reduce((n, f) => n + f.storeys.length, 0));
  });

  it('goal 1: draws every wall crossing the cut as closed cut geometry', () => {
    const ground = sheetRows().find((r) => r.fixture === 'AC20-FZK-Haus' && r.storey === 'Erdgeschoss');
    expect(ground?.wallsCrossing).toBe(9);
    for (const row of sheetRows()) {
      expect(row.missingWalls, `${row.fixture}/${row.storey}`).toEqual([]);
    }
    expect(sheetRows().some((r) => r.fixture === 'building-architecture' && r.wallsCut > 0)).toBe(true);
  });

  it('goal 2: draws no type-library geometry and no spaces, openings or site as cut fabric', () => {
    for (const row of sheetRows()) {
      expect(row.typeLibraryItems, `${row.fixture}/${row.storey}`).toBe(0);
      expect(row.nonFabricPolygons, `${row.fixture}/${row.storey}`).toBe(0);
    }
    for (const row of rows.filter((r) => r.pipeline === 'generateFloorPlan')) expect(row.typeLibraryItems).toBe(0);
    for (const row of sheetRows()) expect(row.spacesLabelled, `${row.fixture}/${row.storey}`).toBe(row.spacesOnCut);
    expect(sheetRows().find((r) => r.fixture === 'AC20-FZK-Haus' && r.storey === 'Erdgeschoss')?.spacesOnCut).toBeGreaterThan(0);
  });

  it('goal 3: cuts each storey at its elevation + 1.2 m in model coordinates', () => {
    for (const row of sheetRows()) expect(row.cutAtModelHeight, `${row.fixture}/${row.storey}`).toBe(true);
  });

  it('goal 4: draws one swing per door and a symbol per window of the storey', () => {
    for (const row of sheetRows()) {
      expect(row.doorSymbols, `${row.fixture}/${row.storey}`).toBe(row.doorsOnStorey);
      expect(row.windowSymbols, `${row.fixture}/${row.storey}`).toBe(row.windowsOnStorey);
    }
    const ground = sheetRows().find((r) => r.fixture === 'AC20-FZK-Haus' && r.storey === 'Erdgeschoss');
    expect(ground?.doorsOnStorey).toBeGreaterThan(0);
  });

  it('goal 5: hatches every cut wall, by material category where the model names one', () => {
    for (const row of sheetRows()) expect(row.cutWallsHatched, `${row.fixture}/${row.storey}`).toBe(row.wallsCut);
    const fzk = sheetRows().filter((r) => r.fixture === 'AC20-FZK-Haus');
    for (const row of fzk) expect(row.wallsMaterialHatched, row.storey).toBe(row.wallsCut);
  });

  it('goal 6: dimensions every facade, chains each exterior jamb and crosses every room both ways', () => {
    if (process.env.PLAN_PARITY_OUT) console.table(dimensionRows);
    expect(dimensionRows.length).toBe(sheetRows().length);
    for (const row of dimensionRows) {
      const where = `${row.fixture}/${row.storey}`;
      const walls = sheetRows().find((r) => r.fixture === row.fixture && r.storey === row.storey)?.wallsCut ?? 0;
      expect(row.sidesDimensioned, where).toBe(walls > 0 ? 4 : 0);
      expect(row.chainsClosing, where).toBe(row.openingChains);
      expect(row.undimensionedOpenings, where).toEqual([]);
      expect(row.spacesCrossedBothWays, where).toBe(row.spacesLabelled);
      expect(row.interiorObstacleCrossings, where).toBe(0);
      expect(row.interiorTextsOnObstacles, where).toBe(0);
    }
    const ground = dimensionRows.find((r) => r.fixture === 'AC20-FZK-Haus' && r.storey === 'Erdgeschoss');
    expect(ground?.exteriorOpenings).toBe(10);
    expect(ground?.spacesLabelled).toBe(6);
  });
});
