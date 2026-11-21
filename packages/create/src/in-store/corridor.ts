/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { PropertyValueType } from '@ifc-lite/data';
import { generateIfcGuid, type RandomSource } from '@ifc-lite/encoding';
import type { IfcAttributeValue, MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import { emitAlignment } from '../ifc-creator-alignment.js';
import type { HorizontalSegment } from '../landxml/alignment-mapping.js';
import type { VerticalSegment } from '../landxml/profile-geometry.js';
import { buildCorridor, type Corridor, type CorridorDefinition, type CorridorTriangle } from '../corridor/corridor.js';
import { parseCorridorDefinition } from '../corridor/definition.js';
import { emitLocalPlacement, ownerHistoryRef, productGuid } from './_emit-helpers.js';
import { parseStepAttributeList } from './step-record-attrs.js';

export const CORRIDOR_PSET = 'IfcLite_Corridor';

export type PavementType = 'FLEXIBLE' | 'RIGID' | 'USERDEFINED' | 'NOTDEFINED';

/** Where a corridor goes: the site that contains it, the project its alignment hangs from, and the contexts. */
export interface CorridorAnchor {
  ownerHistoryId: number | null;
  bodyContextId: number;
  axisContextId: number;
  projectId: number;
  siteId: number;
  sitePlacementId: number;
  /** Metres per file length unit. */
  lengthUnitScale?: number;
  guidRandom?: RandomSource;
}

export interface CorridorParams {
  Name: string;
  Description?: string;
  /** What kind of way this is, e.g. street, driveway or footpath. */
  ObjectType?: string;
  PredefinedType?: PavementType;
  GlobalId?: string;
  /** Site coordinates, metres. */
  Definition: CorridorDefinition;
}

export interface CorridorResult {
  corridor: Corridor;
  pavementId: number;
  kerbIds: number[];
  alignmentId: number;
}

function scaledHorizontal(segments: readonly HorizontalSegment[], native: (m: number) => number): HorizontalSegment[] {
  return segments.map((s) => ({
    ...s,
    start: [native(s.start[0]), native(s.start[1])],
    end: [native(s.end[0]), native(s.end[1])],
    startRadius: native(s.startRadius),
    endRadius: native(s.endRadius),
    length: native(s.length),
    startCurvature: s.startRadius === 0 ? 0 : 1 / native(s.startRadius),
    endCurvature: s.endRadius === 0 ? 0 : 1 / native(s.endRadius),
  }));
}

function scaledVertical(segments: readonly VerticalSegment[], native: (m: number) => number): VerticalSegment[] {
  return segments.map((s) => ({
    ...s,
    startDistAlong: native(s.startDistAlong),
    horizontalLength: native(s.horizontalLength),
    startHeight: native(s.startHeight),
    radiusOfCurvature: s.radiusOfCurvature === null ? null : native(s.radiusOfCurvature),
  }));
}

function body(editor: StoreEditor, anchor: CorridorAnchor, corridor: Corridor, triangles: readonly CorridorTriangle[], native: (m: number) => number): number {
  const used = [...new Set(triangles.flat())];
  const index = new Map(used.map((v, i) => [v, i + 1]));
  const coordinates = used.map((v) => corridor.mesh.positions[v].map(native));
  const coordIndex = triangles.map((tri) => tri.map((v) => index.get(v) ?? 0));
  const points = editor.addEntity('IfcCartesianPointList3D', [coordinates, null]).expressId;
  const faces = editor.addEntity('IfcTriangulatedFaceSet', [`#${points}`, null, false, coordIndex, null]).expressId;
  const representation = editor.addEntity('IfcShapeRepresentation', [`#${anchor.bodyContextId}`, 'Body', 'Tessellation', [`#${faces}`]]).expressId;
  return editor.addEntity('IfcProductDefinitionShape', [null, null, [`#${representation}`]]).expressId;
}

/**
 * A street, driveway or path as IFC 4.3: an `IfcPavement` with its kerbs
 * (`IfcKerb`, aggregated), its tessellated body in site coordinates, and the
 * `IfcAlignment` (horizontal and vertical layouts) it was built from,
 * related by `IfcRelPositions`. The alignment hangs from the project and is
 * referenced in the site; the pavement is contained in the site, like the
 * terrain it is set into. The definition is recorded on the pavement.
 */
export function addCorridorInStore(editor: StoreEditor, anchor: CorridorAnchor, params: CorridorParams): CorridorResult {
  const corridor = buildCorridor(params.Definition);
  const scale = anchor.lengthUnitScale ?? 1;
  const native = (m: number): number => m / scale;
  const owner = ownerHistoryRef(anchor.ownerHistoryId);
  const guid = (): string => generateIfcGuid(anchor.guidRandom);
  const rel = (type: string, tail: IfcAttributeValue[]): number => editor.addEntity(type, [guid(), owner, null, null, ...tail]).expressId;

  const alignmentPlacement = emitLocalPlacement(editor, anchor.sitePlacementId, [0, 0, 0]);
  const alignment = emitAlignment({
    Name: params.Name,
    StartStation: 0,
    Segments: scaledHorizontal(corridor.horizontal, native),
    Vertical: { Segments: scaledVertical(corridor.vertical, native) },
  }, {
    emit: (type, attrs) => editor.addEntity(type, parseStepAttributeList(attrs)).expressId,
    newGlobalId: guid,
    ownerRef: owner ?? '$',
    axisContextRef: `#${anchor.axisContextId}`,
    placementRef: `#${alignmentPlacement}`,
  });

  const element = (type: string, name: string, shape: number, predefined: string, globalId?: string): number => editor.addEntity(type, [
    productGuid({ GlobalId: globalId }, anchor.guidRandom), owner, name, params.Description ?? null, params.ObjectType ?? null,
    `#${emitLocalPlacement(editor, anchor.sitePlacementId, [0, 0, 0])}`, `#${shape}`, null, predefined,
  ]).expressId;
  const pavementId = element('IfcPavement', params.Name, body(editor, anchor, corridor, corridor.mesh.pavement, native), `.${params.PredefinedType ?? 'NOTDEFINED'}.`, params.GlobalId);
  const kerbIds = [corridor.mesh.kerbLeft, corridor.mesh.kerbRight]
    .filter((triangles) => triangles.length > 0)
    .map((triangles) => element('IfcKerb', params.Name, body(editor, anchor, corridor, triangles, native), '.NOTDEFINED.'));

  rel('IfcRelContainedInSpatialStructure', [[`#${pavementId}`], `#${anchor.siteId}`]);
  if (kerbIds.length > 0) rel('IfcRelAggregates', [`#${pavementId}`, kerbIds.map((id) => `#${id}`)]);
  rel('IfcRelAggregates', [`#${anchor.projectId}`, [`#${alignment.alignmentId}`]]);
  rel('IfcRelReferencedInSpatialStructure', [[`#${alignment.alignmentId}`], `#${anchor.siteId}`]);
  rel('IfcRelPositions', [`#${alignment.alignmentId}`, [pavementId, ...kerbIds].map((id) => `#${id}`)]);
  editor.getMutationView().setProperty(pavementId, CORRIDOR_PSET, 'Definition', JSON.stringify(params.Definition), PropertyValueType.Text);
  return { corridor, pavementId, kerbIds, alignmentId: alignment.alignmentId };
}

/** The definition a corridor was built from, read back from its pavement, or null for one made some other way. */
export function readCorridorInStore(view: Pick<MutablePropertyView, 'getPropertyValue'>, pavementId: number): CorridorDefinition | null {
  return parseCorridorDefinition(view.getPropertyValue(pavementId, CORRIDOR_PSET, 'Definition'));
}
