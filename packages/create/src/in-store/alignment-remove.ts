/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { effectiveReferencers } from '@ifc-lite/export';
import type { IfcAttributeValue, StoreEditor } from '@ifc-lite/mutations';
import type { IfcDataStore } from '@ifc-lite/parser';
import { readFileRecord } from './step-record-attrs.js';

const LAYOUT_TYPES: ReadonlySet<string> = new Set([
  'IFCALIGNMENT', 'IFCALIGNMENTHORIZONTAL', 'IFCALIGNMENTVERTICAL', 'IFCALIGNMENTCANT', 'IFCALIGNMENTSEGMENT', 'IFCREFERENT',
]);
const SHARED_TYPES: ReadonlySet<string> = new Set([
  'IFCGEOMETRICREPRESENTATIONCONTEXT', 'IFCGEOMETRICREPRESENTATIONSUBCONTEXT', 'IFCOWNERHISTORY', 'IFCPROJECT', 'IFCSITE',
]);
const WORK_LIMIT = 200_000;

function refsIn(value: IfcAttributeValue | undefined, out: number[]): void {
  if (Array.isArray(value)) for (const item of value) refsIn(item, out);
  else if (typeof value === 'string' && /^#\d+$/.test(value)) out.push(Number(value.slice(1)));
}

/**
 * Remove an `IfcAlignment` with its layouts, segments, referents and curves,
 * and the relationships that name them: every record reachable from it that
 * nothing outside goes on using. Shared records (contexts, owner history,
 * placements, the products it positions) stay.
 */
export function removeAlignmentInStore(store: IfcDataStore, editor: StoreEditor, alignmentId: number): number[] {
  const view = editor.getMutationView();
  const referencers = effectiveReferencers(store, view);
  const record = (id: number): { type: string; attributes: IfcAttributeValue[] } | null => {
    const found = view.getNewEntity(id) ?? readFileRecord(store, view, id);
    return found ? { type: found.type.toUpperCase(), attributes: found.attributes } : null;
  };
  const owned = new Set<number>();
  const pending = [alignmentId];
  let work = 0;
  while (pending.length > 0) {
    if (++work > WORK_LIMIT) throw new Error(`Removing alignment #${alignmentId} exceeds its work budget`);
    const id = pending.pop();
    if (id === undefined || owned.has(id)) continue;
    const entity = record(id);
    if (!entity || SHARED_TYPES.has(entity.type)) continue;
    owned.add(id);
    const forward: number[] = [];
    refsIn(entity.attributes, forward);
    pending.push(...forward);
    if (LAYOUT_TYPES.has(entity.type)) {
      for (const rel of referencers(id)) if (record(rel)?.type.startsWith('IFCREL')) pending.push(rel);
    }
  }
  const kept = new Set<number>();
  const keep = (id: number): void => {
    const stack = [id];
    while (stack.length > 0) {
      const next = stack.pop();
      if (next === undefined || kept.has(next) || !owned.has(next)) continue;
      kept.add(next);
      const forward: number[] = [];
      refsIn(record(next)?.attributes, forward);
      stack.push(...forward);
    }
  };
  for (const id of owned) {
    if (referencers(id).some((ref) => !owned.has(ref))) keep(id);
  }
  const removed = [...owned].filter((id) => !kept.has(id));
  for (const id of removed) editor.removeEntity(id);
  return removed;
}
