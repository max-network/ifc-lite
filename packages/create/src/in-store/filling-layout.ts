/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Part layout of a door or window body, in the filling's own frame: x along
 * the wall (centred), z up from the bottom edge, metres. Pure, so the layout
 * can be checked without emitting anything; `filling-body.ts` turns it into
 * extruded solids.
 */

/** An axis-aligned rectangle in the filling's plane. */
export interface FillingRect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface WindowLayout {
  /** The lining's face width actually used (capped to fit). */
  lining: number;
  /** The clear opening inside the lining. */
  clear: FillingRect;
  /** Mullions and transoms. */
  bars: FillingRect[];
  /** One glazed panel per partition. */
  panes: FillingRect[];
}

export interface DoorLayout {
  lining: number;
  /** Jambs and head as one U outline, counter-clockwise. */
  frame: Array<[number, number]>;
  leaves: FillingRect[];
  handles: FillingRect[];
}

/** Default face width of a lining, mullion or transom (metres). */
export const DEFAULT_LINING_THICKNESS = 0.05;
const LEAF_GAP = 0.004;
const LEAF_FLOOR_GAP = 0.008;
const HANDLE_LENGTH = 0.12;
const HANDLE_SIZE = 0.022;
const HANDLE_HEIGHT = 1.05;
const HANDLE_INSET = 0.07;

const width = (r: FillingRect) => r.x1 - r.x0;
const height = (r: FillingRect) => r.z1 - r.z0;

/** The lining width that fits: at most a quarter of either outer dimension. */
function fittedLining(lining: number, outerWidth: number, outerHeight: number): number {
  return Math.min(lining, outerWidth / 4, outerHeight / 4);
}

/** Split `rect` into `count` equal clear panels along `axis`, with bars `bar` wide between them. */
function divide(rect: FillingRect, count: number, axis: 'x' | 'z', bar: number): { panes: FillingRect[]; bars: FillingRect[] } {
  const span = axis === 'x' ? width(rect) : height(rect);
  const pane = (span - (count - 1) * bar) / count;
  const panes: FillingRect[] = [];
  const bars: FillingRect[] = [];
  for (let i = 0; i < count; i++) {
    const start = (axis === 'x' ? rect.x0 : rect.z0) + i * (pane + bar);
    panes.push(axis === 'x' ? { ...rect, x0: start, x1: start + pane } : { ...rect, z0: start, z1: start + pane });
    if (i < count - 1) {
      const b = start + pane;
      bars.push(axis === 'x' ? { ...rect, x0: b, x1: b + bar } : { ...rect, z0: b, z1: b + bar });
    }
  }
  return { panes, bars };
}

/** Split once, then split one of the two halves again across the other axis. */
function compound(clear: FillingRect, first: 'x' | 'z', splitSecond: 0 | 1, bar: number): { panes: FillingRect[]; bars: FillingRect[] } {
  const outer = divide(clear, 2, first, bar);
  const inner = divide(outer.panes[splitSecond], 2, first === 'x' ? 'z' : 'x', bar);
  const kept = outer.panes[splitSecond === 0 ? 1 : 0];
  return { panes: splitSecond === 0 ? [...inner.panes, kept] : [kept, ...inner.panes], bars: [...outer.bars, ...inner.bars] };
}

function partitions(partitioning: string, clear: FillingRect, bar: number): { panes: FillingRect[]; bars: FillingRect[] } {
  switch (partitioning) {
    case 'DOUBLE_PANEL_VERTICAL': return divide(clear, 2, 'x', bar);
    case 'DOUBLE_PANEL_HORIZONTAL': return divide(clear, 2, 'z', bar);
    case 'TRIPLE_PANEL_VERTICAL': return divide(clear, 3, 'x', bar);
    case 'TRIPLE_PANEL_HORIZONTAL': return divide(clear, 3, 'z', bar);
    case 'TRIPLE_PANEL_BOTTOM': return compound(clear, 'z', 1, bar);
    case 'TRIPLE_PANEL_TOP': return compound(clear, 'z', 0, bar);
    case 'TRIPLE_PANEL_LEFT': return compound(clear, 'x', 1, bar);
    case 'TRIPLE_PANEL_RIGHT': return compound(clear, 'x', 0, bar);
    default: return { panes: [clear], bars: [] };
  }
}

/**
 * Lining, mullions/transoms and panes of a `outerWidth × outerHeight` window
 * partitioned per IfcWindowTypePartitioningEnum. Values outside the enum
 * (and SINGLE_PANEL, NOTDEFINED, USERDEFINED) give one pane. A partitioning
 * too fine for the size falls back to one pane rather than a negative one.
 */
export function windowLayout(partitioning: string | undefined, outerWidth: number, outerHeight: number, lining = DEFAULT_LINING_THICKNESS): WindowLayout {
  const f = fittedLining(lining, outerWidth, outerHeight);
  const clear = { x0: -outerWidth / 2 + f, z0: f, x1: outerWidth / 2 - f, z1: outerHeight - f };
  const split = partitions(partitioning ?? 'SINGLE_PANEL', clear, f);
  const usable = split.panes.every(p => width(p) > 1e-9 && height(p) > 1e-9);
  return { lining: f, clear, ...(usable ? split : { panes: [clear], bars: [] }) };
}

/** Which edge of each leaf takes the handle, per IfcDoorTypeOperationEnum. */
function handleEdges(operation: string): 'none' | 'left' | 'right' | 'meeting' {
  if (operation === 'REVOLVING' || operation === 'ROLLINGUP') return 'none';
  if (operation.startsWith('DOUBLE_DOOR')) return 'meeting';
  return operation.includes('RIGHT') ? 'left' : 'right';
}

/**
 * Lining (jambs and head, no threshold), leaves and handles of a door.
 * Double-door operations get two leaves meeting in the middle. The hinge side
 * follows the operation (`_LEFT`: hinges at -x, viewed along +y), and each
 * handle sits on the leaf's free edge at handle height.
 */
export function doorLayout(operation: string | undefined, outerWidth: number, outerHeight: number, lining = DEFAULT_LINING_THICKNESS, withHandles = true): DoorLayout {
  const f = fittedLining(lining, outerWidth, outerHeight);
  const w = outerWidth / 2;
  const frame: Array<[number, number]> = [
    [-w, 0], [-w + f, 0], [-w + f, outerHeight - f], [w - f, outerHeight - f], [w - f, 0], [w, 0], [w, outerHeight], [-w, outerHeight],
  ];
  const gap = Math.min(LEAF_GAP, f / 4);
  const clear = { x0: -w + f + gap, z0: Math.min(LEAF_FLOOR_GAP, outerHeight / 20), x1: w - f - gap, z1: outerHeight - f - gap };
  const op = operation ?? 'SINGLE_SWING_LEFT';
  const edges = handleEdges(op);
  const leaves = edges === 'meeting'
    ? [{ ...clear, x1: -gap / 2 }, { ...clear, x0: gap / 2 }]
    : [clear];
  const handles: FillingRect[] = [];
  const z = Math.min(HANDLE_HEIGHT, clear.z1 - 0.1);
  if (withHandles && edges !== 'none' && z > clear.z0) {
    leaves.forEach((leaf, i) => {
      if (width(leaf) < 2 * (HANDLE_LENGTH + HANDLE_INSET)) return;
      const atRight = edges === 'meeting' ? i === 0 : edges === 'right';
      const x = atRight ? leaf.x1 - HANDLE_INSET : leaf.x0 + HANDLE_INSET;
      const [x0, x1] = atRight ? [x - HANDLE_LENGTH, x] : [x, x + HANDLE_LENGTH];
      handles.push({ x0, x1, z0: z - HANDLE_SIZE / 2, z1: z + HANDLE_SIZE / 2 });
    });
  }
  return { lining: f, frame, leaves, handles };
}
