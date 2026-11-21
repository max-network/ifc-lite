/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { PropertyValueType } from '@ifc-lite/data';
import type { MutablePropertyView } from '@ifc-lite/mutations';

export const VAULT_PSET = 'IfcLite_Vault';
export const VAULT_OBJECT_TYPE = 'VAULT';

export type VaultShape = 'barrel' | 'cross';
export type VaultSpanAxis = 'X' | 'Y';

export interface VaultDefinition {
  Shape: VaultShape;
  Width: number;
  Depth: number;
  Rise: number;
  Thickness: number;
  SpanAxis: VaultSpanAxis;
}

const LENGTHS: ReadonlyArray<'Width' | 'Depth' | 'Rise' | 'Thickness'> = ['Width', 'Depth', 'Rise', 'Thickness'];

export function writeVaultDefinition(view: MutablePropertyView, vaultId: number, definition: VaultDefinition): void {
  view.setProperty(vaultId, VAULT_PSET, 'Shape', definition.Shape, PropertyValueType.Label);
  view.setProperty(vaultId, VAULT_PSET, 'SpanAxis', definition.SpanAxis, PropertyValueType.Label);
  for (const name of LENGTHS) view.setProperty(vaultId, VAULT_PSET, name, definition[name], PropertyValueType.Real);
}

function positive(view: MutablePropertyView, vaultId: number, name: string): number | null {
  const value = view.getPropertyValue(vaultId, VAULT_PSET, name);
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

export function readVaultDefinition(view: MutablePropertyView, vaultId: number): VaultDefinition | null {
  const shape = view.getPropertyValue(vaultId, VAULT_PSET, 'Shape');
  const axis = view.getPropertyValue(vaultId, VAULT_PSET, 'SpanAxis');
  const [Width, Depth, Rise, Thickness] = LENGTHS.map((name) => positive(view, vaultId, name));
  if ((shape !== 'barrel' && shape !== 'cross') || (axis !== 'X' && axis !== 'Y')) return null;
  if (Width === null || Depth === null || Rise === null || Thickness === null) return null;
  return { Shape: shape, Width, Depth, Rise, Thickness, SpanAxis: axis };
}
