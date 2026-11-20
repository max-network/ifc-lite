/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { ArchitecturalSymbol, Line2D, Point2D } from '../types.js';
import type { PlanDimensionChain } from './dimensions/types.js';

export type PlanSymbolKind = 'door' | 'window' | 'space';

/** Symbolic plan linework standing in for an element (door swing, window frame, room boundary). */
export interface PlanSymbol {
  kind: PlanSymbolKind;
  entityId: number;
  ifcType: string;
  modelIndex: number;
  lines: Line2D[];
  /** The parametric symbol behind `lines`, for doors and windows. */
  symbol?: ArchitecturalSymbol;
}

/** A text label placed in drawing space. */
export interface PlanLabel {
  kind: 'space';
  entityId: number;
  modelIndex: number;
  text: string;
  position: Point2D;
}

/** What the model states about a door or window, beyond its mesh. */
export interface PlanOpeningInfo {
  /** `IfcDoor.OperationType`, else its type's (IfcDoorTypeOperationEnum), as authored. */
  operationType?: string;
  /** `IfcWindow.PartitioningType`, else its type's, as authored. */
  partitioningType?: string;
  /** Overall width in metres (`OverallWidth`). Falls back to the mesh extent along the element's local X. */
  width?: number;
  /** Host wall thickness in metres, for the window frame lines. Falls back to the window's own depth. */
  wallThickness?: number;
}

/** What `generateStoreyPlan` adds to a drawing: symbols, labels and, with its `dimensions` option, dimension chains. */
export interface PlanAnnotations {
  planSymbols: PlanSymbol[];
  planLabels: PlanLabel[];
  planDimensions: PlanDimensionChain[];
}
