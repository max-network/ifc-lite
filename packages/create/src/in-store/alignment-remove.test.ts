/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { IfcParser, type IfcDataStore } from '@ifc-lite/parser';
import { StepExporter } from '@ifc-lite/export';
import { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import { IfcCreator } from '../ifc-creator.js';
import type { CorridorDefinition } from '../corridor/corridor.js';
import { removeAlignmentInStore } from './alignment-remove.js';
import { addCorridorInStore } from './corridor.js';
import { refId } from './host-geometry-frame.js';
import { AnchorEntityReader, resolveSpatialAnchor } from './resolve-anchor.js';

const DEFINITION: CorridorDefinition = {
  Centreline: [[0, 0], [30, 0], [55, 25]], Radii: [15], Width: 5, CrossFall: 0.025, CrossFallSide: 'camber',
  Profile: [{ Station: 0, Height: 0 }, { Station: 40, Grade: 0.04 }, { Station: 60, Grade: 0.08 }], MaxGrade: 0.12, MinK: 4,
};

const parse = (text: string) => new IfcParser().parseColumnar(new TextEncoder().encode(text).buffer, { disableWorkerScan: true });
const exported = (store: IfcDataStore, view: MutablePropertyView) =>
  new TextDecoder().decode(new StepExporter(store, view).export({ schema: 'IFC4X3', applyMutations: true }).content);

async function withCorridor() {
  const creator = new IfcCreator({ Schema: 'IFC4X3', LengthUnit: 'MILLIMETRE' });
  const storey = creator.addIfcBuildingStorey({ Name: 'GF', Elevation: 0 });
  const store = await parse(creator.toIfc().content);
  const view = new MutablePropertyView(null, 'm');
  const editor = new StoreEditor(store, view);
  const anchor = resolveSpatialAnchor(store, storey, view);
  const projectId = store.entityIndex.byType.get('IFCPROJECT')?.[0] ?? 0;
  const siteId = store.entityIndex.byType.get('IFCSITE')?.[0] ?? 0;
  const sitePlacementId = refId(new AnchorEntityReader(store, view).entity(siteId)?.attributes[5]) ?? 0;
  const result = addCorridorInStore(editor, { ...anchor, projectId, siteId, sitePlacementId, lengthUnitScale: 0.001 }, { Name: 'Road', Definition: DEFINITION });
  return { store, view, editor, result };
}

const ALIGNMENT_RECORDS = /IFCALIGNMENT(HORIZONTAL|VERTICAL|SEGMENT|HORIZONTALSEGMENT|VERTICALSEGMENT)?\(|IFCCURVESEGMENT\(|IFCGRADIENTCURVE\(|IFCREFERENT\(|IFCRELNESTS\(|IFCRELPOSITIONS\(|IFCRELREFERENCEDINSPATIALSTRUCTURE\(/;

describe('removeAlignmentInStore', () => {
  it('removes an alignment added this session with every record only it used', async () => {
    const { store, view, editor, result } = await withCorridor();
    expect(exported(store, view)).toMatch(ALIGNMENT_RECORDS);
    removeAlignmentInStore(store, editor, result.alignmentId);
    const step = exported(store, view);
    expect(step).not.toMatch(ALIGNMENT_RECORDS);
    expect(step).toMatch(/IFCPAVEMENT\(/);
    expect(step).toMatch(/IFCPROJECT\(/);
    expect(step).toMatch(/IFCSITE\(/);
    expect(step).toMatch(/IFCGEOMETRICREPRESENTATIONSUBCONTEXT\(\$,'Axis'/);
  });

  it('removes an alignment read from the file the same way', async () => {
    const first = await withCorridor();
    const store = await parse(exported(first.store, first.view));
    const view = new MutablePropertyView(null, 'm');
    const alignment = store.entityIndex.byType.get('IFCALIGNMENT')?.[0] ?? 0;
    removeAlignmentInStore(store, new StoreEditor(store, view), alignment);
    const step = exported(store, view);
    expect(step).not.toMatch(ALIGNMENT_RECORDS);
    expect(step).toMatch(/IFCGEOMETRICREPRESENTATIONSUBCONTEXT\(\$,'Axis'/);
    expect(step).toMatch(/IFCPAVEMENT\(/);
    expect(step).toMatch(/IFCOWNERHISTORY\(|IFCPROJECT\(/);
  });
});
