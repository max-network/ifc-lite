/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A real IFC model loaded the way a headless caller loads it: meshes from
 * `GeometryProcessor`, storeys, door/window attributes, room names and material
 * names from the parser. Only the shapes the plan API takes leave this module.
 */

import { existsSync, readFileSync } from 'node:fs';
import { GeometryProcessor, type CoordinateInfo, type MeshData } from '@ifc-lite/geometry';
import { IfcParser, effectiveMetadataRecord, extractMaterialsOnDemand, type IfcDataStore } from '@ifc-lite/parser';
import { RelationshipType, type SpatialNode } from '@ifc-lite/data';

export const WASM_PATH = new URL('../../../wasm/pkg/ifc-lite_bg.wasm', import.meta.url);
export const wasmAvailable = existsSync(WASM_PATH);

export interface FixtureStorey {
  id: number;
  name: string;
  elevation: number;
  height?: number;
  elements: Set<number>;
}

export interface FixtureOpening {
  operationType?: string;
  partitioningType?: string;
  width?: number;
}

export interface PlanFixture {
  name: string;
  meshes: MeshData[];
  frame: CoordinateInfo;
  storeys: FixtureStorey[];
  ifcTypeOf: ReadonlyMap<number, string>;
  openings: Map<number, FixtureOpening>;
  spaceLabels: Map<number, string>;
  /** Material name per element id and per `IfcMaterial` id a mesh slices. */
  materialNames: Map<number, string>;
}

let wasmReady = false;
async function ensureWasm(): Promise<void> {
  if (wasmReady) return;
  const { initSync } = await import('@ifc-lite/wasm');
  initSync({ module: readFileSync(WASM_PATH) });
  wasmReady = true;
}

function attribute(store: IfcDataStore, id: number, name: string): unknown {
  const record = effectiveMetadataRecord(store, id);
  if (!record) return undefined;
  const index = record.names.indexOf(name);
  return index >= 0 ? record.attributes[index] : undefined;
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined);
const num = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

function typeObjectOf(store: IfcDataStore, id: number): number | undefined {
  return store.relationships?.getRelated(id, RelationshipType.DefinesByType, 'inverse')[0];
}

function readOpening(store: IfcDataStore, id: number, isDoor: boolean): FixtureOpening {
  const typeId = typeObjectOf(store, id);
  const own = (name: string) => text(attribute(store, id, name));
  const fromType = (name: string) => (typeId === undefined ? undefined : text(attribute(store, typeId, name)));
  const stated = (value: string | undefined) => (value && value !== '.NOTDEFINED.' && value !== 'NOTDEFINED' ? value : undefined);
  const key = isDoor ? 'OperationType' : 'PartitioningType';
  const enumValue = stated(own(key)) ?? stated(fromType(key));
  const width = num(attribute(store, id, 'OverallWidth'));
  return {
    ...(isDoor ? { operationType: enumValue } : { partitioningType: enumValue }),
    width: width === undefined ? undefined : width * (store.lengthUnitScale ?? 1),
  };
}

function materialName(store: IfcDataStore, id: number): string | undefined {
  const info = extractMaterialsOnDemand(store, id);
  if (!info) return undefined;
  return text(info.layers?.[0]?.materialName) ?? text(info.name) ?? text(info.materials?.[0]?.name);
}

/** A storey's contained elements plus the spatial children (spaces) aggregated under it, and their contents. */
function storeyMembers(root: SpatialNode | undefined, storeyId: number, members: Set<number>): Set<number> {
  const find = (node: SpatialNode): SpatialNode | undefined =>
    node.expressId === storeyId ? node : node.children.map(find).find((n) => n !== undefined);
  const collect = (node: SpatialNode) => {
    for (const child of node.children) {
      members.add(child.expressId);
      for (const element of child.elements) members.add(element);
      collect(child);
    }
  };
  const storey = root ? find(root) : undefined;
  if (storey) collect(storey);
  return members;
}

export async function loadPlanFixture(name: string, path: string): Promise<PlanFixture> {
  await ensureWasm();
  const bytes = readFileSync(path);
  const processor = new GeometryProcessor();
  let meshes: MeshData[];
  let frame: CoordinateInfo;
  try {
    await processor.init();
    const result = await processor.process(new Uint8Array(bytes));
    meshes = result.meshes;
    frame = result.coordinateInfo;
  } finally {
    processor.dispose();
  }

  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const store = await new IfcParser().parseColumnar(buffer, { disableWorkerScan: true });
  const hierarchy = store.spatialHierarchy;
  const levels = [...(hierarchy?.storeyElevations ?? new Map<number, number>())].sort((a, b) => a[1] - b[1]);
  const storeys: FixtureStorey[] = levels.map(([id, elevation], i) => ({
    id,
    name: text(attribute(store, id, 'Name')) ?? `#${id}`,
    elevation,
    height: i + 1 < levels.length ? levels[i + 1][1] - elevation : undefined,
    elements: storeyMembers(hierarchy?.project, id, new Set(hierarchy?.byStorey.get(id) ?? [])),
  }));

  const ifcTypeOf = new Map<number, string>();
  for (const mesh of meshes) if (mesh.ifcType) ifcTypeOf.set(mesh.expressId, mesh.ifcType);
  const openings = new Map<number, FixtureOpening>();
  const spaceLabels = new Map<number, string>();
  const materialNames = new Map<number, string>();
  for (const [id, type] of ifcTypeOf) {
    const lower = type.toLowerCase();
    if (lower.startsWith('ifcdoor') || lower.startsWith('ifcwindow')) {
      if (!lower.endsWith('type')) openings.set(id, readOpening(store, id, lower.startsWith('ifcdoor')));
    } else if (lower === 'ifcspace') {
      const label = text(attribute(store, id, 'LongName')) ?? text(attribute(store, id, 'Name'));
      if (label) spaceLabels.set(id, label);
    }
    const material = materialName(store, id);
    if (material) materialNames.set(id, material);
  }
  for (const mesh of meshes) {
    if (mesh.materialId === undefined || materialNames.has(mesh.materialId)) continue;
    const material = text(attribute(store, mesh.materialId, 'Name'));
    if (material) materialNames.set(mesh.materialId, material);
  }
  return { name, meshes, frame, storeys, ifcTypeOf, openings, spaceLabels, materialNames };
}
