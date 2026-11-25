/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Compiles every WHERE rule, DERIVE expression, FUNCTION and global RULE of a
 * schema into one TypeScript module. A construct the translator cannot
 * compile lands in `unsupported` with its reason, so the runtime reports the
 * rule as not evaluated instead of passing it.
 */

import type { EntityDecl } from '../express/ast.js';
import { ExpressionTranslator } from './expr-translator.js';
import type { SchemaIndex } from './schema-index.js';
import { StatementTranslator } from './stmt-translator.js';
import { Scope, TranslateContext, UnsupportedConstruct } from './translate-context.js';

export interface UnsupportedEntry {
  scope: 'entity' | 'type' | 'derived' | 'global' | 'function';
  owner: string;
  label: string;
  reason: string;
}

export interface RuleCompilation {
  source: string;
  unsupported: UnsupportedEntry[];
  counts: Record<'entity' | 'type' | 'derived' | 'global' | 'function', { total: number; compiled: number }>;
}

function reasonOf(e: unknown): string {
  if (e instanceof UnsupportedConstruct) return e.message;
  throw e;
}

interface CompiledFunction {
  source: string;
  calls: Set<string>;
}

function compileFunctions(index: SchemaIndex, ctx: TranslateContext, stmts: StatementTranslator): Map<string, CompiledFunction> {
  const unsupported = ctx.unsupportedFunctions;
  const compiled = new Map<string, CompiledFunction>();
  for (const fn of index.schema.functions) {
    ctx.calls = new Set();
    try {
      compiled.set(fn.name.toUpperCase(), { source: stmts.functionSource(fn), calls: ctx.calls });
    } catch (e) {
      unsupported.set(fn.name.toUpperCase(), reasonOf(e));
    }
  }
  for (let changed = true; changed;) {
    changed = false;
    for (const [name, fn] of compiled) {
      const bad = [...fn.calls].find((c) => unsupported.has(c));
      if (!bad) continue;
      unsupported.set(name, `calls ${index.function(bad)?.name ?? bad}, which did not compile`);
      compiled.delete(name);
      changed = true;
    }
  }
  return compiled;
}

/** Upper names of the functions `roots` call, directly or through another compiled function. */
function reachableFunctions(roots: ReadonlySet<string>, functions: ReadonlyMap<string, CompiledFunction>): Set<string> {
  const reached = new Set<string>();
  const pending = [...roots];
  for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
    if (reached.has(name)) continue;
    reached.add(name);
    pending.push(...(functions.get(name)?.calls ?? []));
  }
  return reached;
}

function indent(text: string, pad: string): string {
  return text.split('\n').map((l, i) => (i === 0 ? l : pad + l)).join('\n');
}

export function compileRules(index: SchemaIndex, header: string, runtimeImport: string): RuleCompilation {
  const unsupportedFunctions = new Map<string, string>();
  const ctx = new TranslateContext(index, unsupportedFunctions);
  const expr = new ExpressionTranslator(ctx);
  const stmts = new StatementTranslator(expr);
  const functions = compileFunctions(index, ctx, stmts);
  const roots = new Set<string>();
  const tracked = (translate: () => string): string => {
    ctx.calls = new Set();
    const source = translate();
    for (const call of ctx.calls) roots.add(call);
    return source;
  };
  const unsupported: UnsupportedEntry[] = [];
  const counts: RuleCompilation['counts'] = {
    entity: { total: 0, compiled: 0 }, type: { total: 0, compiled: 0 }, derived: { total: 0, compiled: 0 },
    global: { total: 0, compiled: 0 }, function: { total: index.schema.functions.length, compiled: functions.size },
  };
  for (const fn of index.schema.functions) {
    const reason = unsupportedFunctions.get(fn.name.toUpperCase());
    if (reason !== undefined) unsupported.push({ scope: 'function', owner: fn.name, label: fn.name, reason });
  }

  const derived: string[] = [];
  const failedDerived = new Map<string, string>();
  for (const e of index.schema.entities) {
    for (const d of e.derived) {
      counts.derived.total++;
      try {
        derived.push(`    ${JSON.stringify(`${e.name}.${d.redeclares?.attribute ?? d.name}`)}: (self: r.EntityInstance, m: r.Model): r.Value => ${tracked(() => expr.translate(d.expr, new Scope('entity', e)))},`);
        counts.derived.compiled++;
      } catch (err) {
        const reason = reasonOf(err);
        failedDerived.set(d.name.toUpperCase(), `${e.name}.${d.name}`);
        unsupported.push({ scope: 'derived', owner: e.name, label: d.name, reason });
      }
    }
  }
  const dependsOnFailedDerived = (source: string): string | undefined => {
    for (const [upper, qualified] of failedDerived) if (new RegExp(`\\b${upper}\\b`, 'i').test(source)) return qualified;
    return undefined;
  };

  const entityRules: string[] = [];
  for (const e of index.schema.entities) {
    const rules = entityRuleSources(e, (w) => tracked(() => expr.translate(w.expr, new Scope('entity', e))), dependsOnFailedDerived, unsupported, counts);
    if (rules.length) entityRules.push(`    ${JSON.stringify(e.name)}: [\n${rules.join('\n')}\n    ],`);
  }

  const typeRules: string[] = [];
  for (const t of index.schema.types) {
    const rules: string[] = [];
    for (const w of t.where) {
      counts.type.total++;
      try {
        rules.push(`      { label: ${JSON.stringify(w.label)}, source: ${JSON.stringify(w.source)}, check: (self: r.Value, m: r.Model): r.Value => ${tracked(() => expr.translate(w.expr, new Scope('type')))} },`);
        counts.type.compiled++;
      } catch (err) {
        unsupported.push({ scope: 'type', owner: t.name, label: w.label, reason: reasonOf(err) });
      }
    }
    if (rules.length) typeRules.push(`    ${JSON.stringify(t.name)}: [\n${rules.join('\n')}\n    ],`);
  }

  const globalRules: string[] = [];
  for (const rule of index.schema.rules) {
    counts.global.total += rule.where.length;
    try {
      const run = tracked(() => stmts.ruleSource(rule));
      const labels = rule.where.map((w) => `{ label: ${JSON.stringify(w.label)}, source: ${JSON.stringify(w.source)} }`);
      globalRules.push(`    { name: ${JSON.stringify(rule.name)}, appliesTo: ${JSON.stringify(rule.appliesTo.map((a) => index.canonical(a) ?? a))}, rules: [${labels.join(', ')}], run: ${indent(run, '  ')} },`);
      counts.global.compiled += rule.where.length;
    } catch (err) {
      const reason = reasonOf(err);
      for (const w of rule.where) unsupported.push({ scope: 'global', owner: rule.name, label: w.label, reason });
    }
  }

  const reached = reachableFunctions(roots, functions);
  const fnSources = index.schema.functions
    .filter((f) => reached.has(f.name.toUpperCase()))
    .map((f) => functions.get(f.name.toUpperCase())?.source)
    .filter((s): s is string => !!s);
  const body = [fnSources, entityRules, typeRules, derived, globalRules].flat().join('\n');
  const constants = [...ctx.constants].filter(([name]) => new RegExp(`\\b${name}\\b`).test(body)).map(([name, init]) => `const ${name} = ${init};`);
  const source = `${header}
import * as r from '${runtimeImport}';

${constants.join('\n')}

${fnSources.join('\n\n')}

export const RULES: r.CompiledRules = {
  entity: {
${entityRules.join('\n')}
  },
  type: {
${typeRules.join('\n')}
  },
  derived: {
${derived.join('\n')}
  },
  global: [
${globalRules.join('\n')}
  ],
  unsupported: ${JSON.stringify(unsupported, null, 1).replace(/\n/g, '\n  ')},
};
`;
  return { source, unsupported, counts };
}

function entityRuleSources(
  e: EntityDecl,
  translate: (w: EntityDecl['where'][number]) => string,
  dependsOnFailedDerived: (source: string) => string | undefined,
  unsupported: UnsupportedEntry[],
  counts: RuleCompilation['counts'],
): string[] {
  const out: string[] = [];
  for (const w of e.where) {
    counts.entity.total++;
    try {
      const failed = dependsOnFailedDerived(w.source);
      if (failed) throw new UnsupportedConstruct(`depends on derived attribute ${failed}, which did not compile`);
      out.push(`      { label: ${JSON.stringify(w.label)}, source: ${JSON.stringify(w.source)}, check: (self: r.EntityInstance, m: r.Model): r.Value => ${translate(w)} },`);
      counts.entity.compiled++;
    } catch (err) {
      unsupported.push({ scope: 'entity', owner: e.name, label: w.label, reason: reasonOf(err) });
    }
  }
  return out;
}
