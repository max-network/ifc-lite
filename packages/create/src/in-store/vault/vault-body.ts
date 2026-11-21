/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { StoreEditor } from '@ifc-lite/mutations';
import { toNativeLength, type SpatialAnchor } from '../anchor.js';
import { ARC_CHORD_TOLERANCE } from '../arch/arch-shape.js';
import { emitPathProfile, padded, scalePath } from '../arch/profile-path.js';
import { barrelProfile, crossVaultFaces, type FaceSet } from './vault-geometry.js';
import type { VaultDefinition } from './vault-definition.js';

type Scale = Pick<SpatialAnchor, 'schema' | 'lengthUnitScale'>;

const ref = (id: number) => `#${id}`;

function emitBarrel(editor: StoreEditor, scale: Scale, definition: VaultDefinition): number {
  const n = (metres: number) => toNativeLength(scale, metres);
  const acrossY = definition.SpanAxis === 'Y';
  const span = acrossY ? definition.Depth : definition.Width;
  const length = acrossY ? definition.Width : definition.Depth;
  const profile = emitPathProfile(editor, scale.schema, scalePath(barrelProfile(span, definition.Rise, definition.Thickness, ARC_CHORD_TOLERANCE), n));
  const location = editor.addEntity('IfcCartesianPoint', [acrossY ? [0, n(definition.Depth / 2), 0] : [n(definition.Width / 2), n(definition.Depth), 0]]).expressId;
  const axis = editor.addEntity('IfcDirection', [acrossY ? [1, 0, 0] : [0, -1, 0]]).expressId;
  const refDirection = editor.addEntity('IfcDirection', [acrossY ? [0, 1, 0] : [1, 0, 0]]).expressId;
  const position = editor.addEntity('IfcAxis2Placement3D', [ref(location), ref(axis), ref(refDirection)]).expressId;
  const up = editor.addEntity('IfcDirection', [[0, 0, 1]]).expressId;
  return editor.addEntity('IfcExtrudedAreaSolid', [ref(profile), ref(position), ref(up), n(length)]).expressId;
}

function emitFaceSet(editor: StoreEditor, scale: Scale, faces: FaceSet): number {
  const coords = faces.coords.map((p) => p.map((value) => toNativeLength(scale, value)));
  if ((scale.schema ?? 'IFC4') === 'IFC2X3') {
    const points = coords.map((p) => editor.addEntity('IfcCartesianPoint', [p]).expressId);
    const bounds = faces.faces.map((face) => {
      const loop = editor.addEntity('IfcPolyLoop', [face.map((i) => ref(points[i]))]).expressId;
      const bound = editor.addEntity('IfcFaceOuterBound', [ref(loop), true]).expressId;
      return ref(editor.addEntity('IfcFace', [[ref(bound)]]).expressId);
    });
    const shell = editor.addEntity('IfcClosedShell', [bounds]).expressId;
    return editor.addEntity('IfcFacetedBrep', [ref(shell)]).expressId;
  }
  const list = editor.addEntity('IfcCartesianPointList3D', padded(scale.schema, 'IfcCartesianPointList3D', [coords])).expressId;
  const polygons = faces.faces.map((face) => ref(editor.addEntity('IfcIndexedPolygonalFace', [face.map((i) => i + 1)]).expressId));
  return editor.addEntity('IfcPolygonalFaceSet', [ref(list), true, polygons, null]).expressId;
}

export function emitVaultBody(editor: StoreEditor, scale: Scale, contextId: number, definition: VaultDefinition): { shapeRepId: number; productShapeId: number } {
  const barrel = definition.Shape === 'barrel';
  const item = barrel
    ? emitBarrel(editor, scale, definition)
    : emitFaceSet(editor, scale, crossVaultFaces(definition.Width, definition.Depth, definition.Rise, definition.Thickness, ARC_CHORD_TOLERANCE));
  const kind = barrel ? 'SweptSolid' : (scale.schema ?? 'IFC4') === 'IFC2X3' ? 'Brep' : 'Tessellation';
  const shapeRepId = editor.addEntity('IfcShapeRepresentation', [ref(contextId), 'Body', kind, [ref(item)]]).expressId;
  const productShapeId = editor.addEntity('IfcProductDefinitionShape', [null, null, [ref(shapeRepId)]]).expressId;
  return { shapeRepId, productShapeId };
}
