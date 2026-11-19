/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The plan parity report: one summary row per goal, then per fixture, storey
 * and pipeline (Passed / Total / Rate), as markdown and JSON.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PlanMetrics } from './metrics.js';

export interface GoalScore {
  goal: string;
  passed: number;
  total: number;
}

const rate = ({ passed, total }: { passed: number; total: number }) => (total === 0 ? 100 : Math.round((passed / total) * 100));

/** Goal scores of one storey plan; each goal counts what a sheet must show. */
export function scoreGoals(m: PlanMetrics): GoalScore[] {
  return [
    { goal: '1 walls on the cut drawn closed', passed: m.wallsCut, total: m.wallsCrossing },
    { goal: '2 no type-library or non-fabric cuts', passed: m.typeLibraryItems === 0 && m.nonFabricPolygons === 0 ? 1 : 0, total: 1 },
    { goal: '2b rooms labelled', passed: m.spacesLabelled, total: m.spacesOnCut },
    { goal: '3 cut at storey + h in model coordinates', passed: m.cutAtModelHeight ? 1 : 0, total: 1 },
    { goal: '4a door swings', passed: m.doorSymbols, total: m.doorsOnStorey },
    { goal: '4b window symbols', passed: m.windowSymbols, total: m.windowsOnStorey },
    { goal: '5a cut walls hatched', passed: m.cutWallsHatched, total: m.wallsCut },
    { goal: '5b cut walls hatched by material', passed: m.wallsMaterialHatched, total: m.wallsCut },
  ];
}

function totals(rows: readonly PlanMetrics[], pipeline: string): GoalScore[] {
  const sums = new Map<string, GoalScore>();
  for (const m of rows.filter((r) => r.pipeline === pipeline)) {
    for (const score of scoreGoals(m)) {
      const sum = sums.get(score.goal) ?? { goal: score.goal, passed: 0, total: 0 };
      sum.passed += score.passed;
      sum.total += score.total;
      sums.set(score.goal, sum);
    }
  }
  return [...sums.values()];
}

export function renderReport(rows: readonly PlanMetrics[], label: string): string {
  const pipelines = [...new Set(rows.map((r) => r.pipeline))];
  let md = `# drawing-2d floor plan parity (${label})\n\n`;
  md += 'Measured by `packages/drawing-2d/test/plan-parity.test.ts` on real models (`PLAN_PARITY_OUT=<dir>`).\n\n';
  md += '## Summary\n\n| Goal | ' + pipelines.join(' | ') + ' |\n|---|' + pipelines.map(() => '---').join('|') + '|\n';
  const byPipeline = pipelines.map((p) => totals(rows, p));
  for (let g = 0; g < (byPipeline[0]?.length ?? 0); g++) {
    md += `| ${byPipeline[0][g].goal} | ` + byPipeline.map((t) => `${t[g].passed}/${t[g].total} (${rate(t[g])}%)`).join(' | ') + ' |\n';
  }
  for (const m of rows) {
    md += `\n## ${m.fixture} / ${m.storey} / \`${m.pipeline}\`\n\n`;
    md += `Cut at model Z ${m.cutModelZ.toFixed(3)} m (intended ${m.expectedCutModelZ.toFixed(3)} m).\n\n`;
    md += '| Metric | Passed | Total | Rate |\n|--------|--------|-------|------|\n';
    for (const score of scoreGoals(m)) md += `| ${score.goal} | ${score.passed} | ${score.total} | ${rate(score)}% |\n`;
    md += `\nType-library items drawn: ${m.typeLibraryItems}; non-fabric cut polygons: ${m.nonFabricPolygons}.`;
    if (m.missingWalls.length > 0) md += ` Walls missing from the cut: ${m.missingWalls.map((id) => `#${id}`).join(', ')}.`;
    md += '\n';
  }
  return md;
}

export function writeReport(dir: string, rows: readonly PlanMetrics[], label: string, svgs: ReadonlyMap<string, string>): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'plan-parity.md'), renderReport(rows, label), 'utf8');
  const summary = Object.fromEntries([...new Set(rows.map((r) => r.pipeline))].map((p) => [p, totals(rows, p)]));
  writeFileSync(join(dir, 'plan-parity.json'), JSON.stringify({ label, summary, rows }, null, 2) + '\n', 'utf8');
  for (const [name, svg] of svgs) writeFileSync(join(dir, `${name}.svg`), svg, 'utf8');
}
