/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseExpressRules } from '../src/express/declaration-parser.js';
import { parseExpression } from '../src/express/expression-parser.js';
import { tokenize } from '../src/express/lexer.js';
import { TokenStream } from '../src/express/token-stream.js';
import { generateValidators } from '../src/validators/index.js';

const schemaSource = (file: string) => readFileSync(join(__dirname, '..', 'schemas', file), 'utf8');
const expr = (src: string) => parseExpression(new TokenStream(tokenize(src), src));

const mini = (where: string, extra = '') => `SCHEMA MINI;
TYPE MiniLabel = STRING; END_TYPE;
TYPE MiniEnum = ENUMERATION OF (A, USERDEFINED); END_TYPE;
ENTITY MiniThing;
  Name : OPTIONAL MiniLabel;
  Kind : MiniEnum;
WHERE
  ${where};
END_ENTITY;
${extra}
END_SCHEMA;`;

describe('EXPRESS expression parser', () => {
  it('binds NOT tighter than OR and AND tighter than OR (ISO 10303-11 12.1)', () => {
    expect(expr('NOT a OR b AND c')).toEqual({
      k: 'binary', op: 'OR',
      left: { k: 'unary', op: 'NOT', operand: { k: 'id', name: 'a' } },
      right: { k: 'binary', op: 'AND', left: { k: 'id', name: 'b' }, right: { k: 'id', name: 'c' } },
    });
  });

  it('parses QUERY, intervals, group qualifiers and indexing', () => {
    const q = expr("SIZEOF(QUERY(t <* SELF\\IfcFace.Bounds | 'IFC4.IFCEDGELOOP' IN TYPEOF(t.Bound))) = 1");
    expect(q.k).toBe('binary');
    expect(expr('{0 <= x < 3}')).toMatchObject({ k: 'interval', op1: '<=', op2: '<' });
    expect(expr('a[1].b')).toMatchObject({ k: 'attr', name: 'b', base: { k: 'index' } });
  });

  it('keeps INTEGER and REAL literals apart', () => {
    expect(expr('1')).toEqual({ k: 'num', value: 1, int: true });
    expect(expr('1.E-5')).toEqual({ k: 'num', value: 1e-5, int: false });
  });
});

describe('EXPRESS rule parser on the bundled schemas', () => {
  it.each([
    ['IFC4_ADD2_TC1.exp', 652, 25, 47, 2],
    ['IFC4X3.exp', 752, 25, 48, 2],
    ['IFC2X3_TC1.exp', 339, 24, 38, 2],
  ])('%s: entity WHERE, type WHERE, functions, global rules', (file, entityWhere, typeWhere, functions, rules) => {
    const s = parseExpressRules(schemaSource(file));
    expect(s.entities.reduce((n, e) => n + e.where.length, 0)).toBe(entityWhere);
    expect(s.types.reduce((n, t) => n + t.where.length, 0)).toBe(typeWhere);
    expect(s.functions).toHaveLength(functions);
    expect(s.rules).toHaveLength(rules);
    expect(s.skipped).toEqual([]);
  });
});

describe('generateValidators', () => {
  it('compiles every rule, DERIVE, FUNCTION and global RULE of IFC4 ADD2 TC1', () => {
    const { coverage } = generateValidators(schemaSource('IFC4_ADD2_TC1.exp'));
    for (const [scope, c] of Object.entries(coverage.counts)) expect(c.compiled, scope).toBe(c.total);
    expect(coverage.unsupported).toEqual([]);
  });

  it('reports a rule it cannot compile instead of dropping it', () => {
    const { coverage } = generateValidators(mini('WR1 : NOT EXISTS(Name) OR MysteryCheck(Name)'));
    expect(coverage.counts.entity).toEqual({ total: 1, compiled: 0 });
    expect(coverage.unsupported).toEqual([
      { scope: 'entity', owner: 'MiniThing', label: 'WR1', reason: 'call to unknown function MysteryCheck' },
    ]);
  });

  it('propagates an uncompilable FUNCTION to its callers and to the rules using them', () => {
    const fns = `FUNCTION Inner (X : MiniLabel) : LOGICAL; RETURN (VALUE_IN([X], X)); END_FUNCTION;
FUNCTION Outer (X : MiniLabel) : LOGICAL; RETURN (Inner(X)); END_FUNCTION;`;
    const { coverage } = generateValidators(mini('WR1 : Outer(Name)', fns));
    expect(coverage.unsupported.map((u) => [u.scope, u.owner])).toEqual([
      ['function', 'Inner'], ['function', 'Outer'], ['entity', 'MiniThing'],
    ]);
    expect(coverage.unsupported[1].reason).toBe('calls Inner, which did not compile: built-in VALUE_IN is not implemented');
  });

  it('emits only the FUNCTIONs a rule reaches, directly or through another FUNCTION', () => {
    const fns = `FUNCTION Leaf (X : MiniLabel) : LOGICAL; RETURN (EXISTS(X)); END_FUNCTION;
FUNCTION Used (X : MiniLabel) : LOGICAL; RETURN (Leaf(X)); END_FUNCTION;
FUNCTION Orphan (K : MiniEnum) : LOGICAL; RETURN (K = MiniEnum.USERDEFINED); END_FUNCTION;`;
    const { files, coverage } = generateValidators(mini('WR1 : Used(Name)', fns));
    expect(files['rules.ts']).toMatch(/function fn_Used\(/);
    expect(files['rules.ts']).toMatch(/function fn_Leaf\(/);
    expect(files['rules.ts']).not.toMatch(/fn_Orphan/);
    expect(files['rules.ts']).not.toMatch(/E_USERDEFINED/);
    expect(coverage.counts.function).toEqual({ total: 3, compiled: 3 });
  });

  it('rejects a qualified enumeration item the enumeration does not declare', () => {
    const { coverage } = generateValidators(mini('WR1 : Kind <> MiniEnum.MISSING'));
    expect(coverage.unsupported[0].reason).toBe('MiniEnum has no item MISSING');
  });
});
