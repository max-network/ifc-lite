/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Sheet-quality floor plan gaps, one block per goal of the plan parity
 * report (`test/plan-parity.test.ts` measures the same goals on real models).
 */

import { describe, it, expect } from 'vitest';
import type { MeshData } from '@ifc-lite/geometry';
import { boxTriangles, placeWorldFrame, asMeshData } from '@ifc-lite/world-frame-fixtures';
import { generateFloorPlan, Drawing2DGenerator, createSectionConfig } from '../drawing-generator.js';
import { exportToSVG } from '../svg-exporter.js';
import type { DoorSwingParameters, Drawing2D } from '../types.js';
import {
  PLAN_ELEMENT_FILTER,
  classifyMaterialName,
  generateStoreyPlan,
  selectDrawableMeshes,
  storeyCutElevation,
} from './index.js';

type V3 = [number, number, number];

function box(expressId: number, ifcType: string, min: V3, max: V3, extra: Partial<MeshData> = {}): MeshData {
  const shape = boxTriangles(min, max);
  const placed = placeWorldFrame(shape.positions, { frameCase: 'local-frame' });
  return { ...asMeshData(placed, shape.indices, { expressId, ifcType }), ...extra };
}

/** Quads as triangles, every face with its own vertices, as CSG output arrives. */
function quads(expressId: number, ifcType: string, faces: V3[][]): MeshData {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const q of faces) {
    const base = positions.length / 3;
    positions.push(...q.flat());
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return {
    expressId, ifcType, modelIndex: 0,
    positions: new Float32Array(positions), normals: new Float32Array(positions.length),
    indices: new Uint32Array(indices), color: [0.6, 0.6, 0.6, 1],
  };
}

/**
 * A 4 m long, 0.3 m thick wall (x 0..4, z 0..0.3, y 0..2.7) with a window hole
 * x 1.5..2.5, y 0.9..2.0, meshed the way a boolean kernel leaves it: the faces
 * around the hole are separate strips, so the jambs meet them in T-junctions.
 */
function wallWithWindowOpening(expressId: number): MeshData {
  const [x0, xa, xb, x1, y0, ya, yb, y1, z0, z1] = [0, 1.5, 2.5, 4, 0, 0.9, 2.0, 2.7, 0, 0.3];
  const face = (z: number): V3[][] => [
    [[x0, y0, z], [xa, y0, z], [xa, y1, z], [x0, y1, z]],
    [[xb, y0, z], [x1, y0, z], [x1, y1, z], [xb, y1, z]],
    [[xa, y0, z], [xb, y0, z], [xb, ya, z], [xa, ya, z]],
    [[xa, yb, z], [xb, yb, z], [xb, y1, z], [xa, y1, z]],
  ];
  return quads(expressId, 'IfcWallStandardCase', [
    ...face(z0), ...face(z1),
    [[xa, ya, z0], [xa, ya, z1], [xa, yb, z1], [xa, yb, z0]],
    [[xb, ya, z0], [xb, yb, z0], [xb, yb, z1], [xb, ya, z1]],
    [[xa, ya, z0], [xb, ya, z0], [xb, ya, z1], [xa, ya, z1]],
    [[xa, yb, z0], [xa, yb, z1], [xb, yb, z1], [xb, yb, z0]],
    [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]],
    [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]],
    [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]],
    [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
  ]);
}

/**
 * An IfcDoor as the wasm pipeline emits it: Y-up object-space `localBounds`,
 * a row-major Y-up `localToWorld`, and world positions. Local X runs along the
 * wall; IFC local +Y (the swing side) is object-space -Z.
 */
function door(expressId: number, at: V3, width = 0.9, pieces = 2): MeshData[] {
  const [tx, ty, tz] = at;
  const localToWorld = [1, 0, 0, tx, 0, 1, 0, ty, 0, 0, 1, tz, 0, 0, 0, 1];
  return Array.from({ length: pieces }, (_, i) => {
    const inset = i * 0.05;
    const min: V3 = [inset, 0, -0.1];
    const max: V3 = [width - inset, 2.1 - inset, 0];
    return box(expressId, 'IfcDoor', [tx + min[0], ty + min[1], tz + min[2]], [tx + max[0], ty + max[1], tz + max[2]], {
      localToWorld,
      localBounds: { min, max },
    });
  });
}

const fast = { useGPU: false, includeHiddenLines: false } as const;
const polygonsOf = (d: Drawing2D, id: number) => d.cutPolygons.filter((p) => p.entityId === id);

describe('goal 1: every wall crossing the cut is drawn as closed cut geometry', () => {
  it('closes both piers of a wall whose window opening the cut passes through', async () => {
    const drawing = await generateFloorPlan([wallWithWindowOpening(10)], 1.2, { ...fast, includeProjection: false });
    const walls = polygonsOf(drawing, 10);
    expect(walls).toHaveLength(2);
    for (const wall of walls) expect(wall.polygon.outer.length).toBeGreaterThanOrEqual(4);
    expect(drawing.lines.filter((l) => l.openSurfaceCut)).toEqual([]);
  });
});

describe('goal 2: only drawable building elements reach the drawing', () => {
  const wall = box(1, 'IfcWall', [0, 0, 0], [4, 3, 0.3]);
  const wallType = box(2, 'IfcWallType', [-0.5, 0, -0.5], [0.5, 3, 0.5], { geometryClass: 2 });
  const orphanType = box(3, 'IfcSlabType', [5, 0, 5], [6, 3, 6], { geometryClass: 1 });

  it('never cuts instanced or orphan type-library geometry next to placed elements', async () => {
    const drawing = await generateFloorPlan([wall, wallType, orphanType], 1.2, fast);
    const ids = new Set([...drawing.cutPolygons.map((p) => p.entityId), ...drawing.lines.map((l) => l.entityId)]);
    expect(ids.has(1)).toBe(true);
    expect(ids.has(2)).toBe(false);
    expect(ids.has(3)).toBe(false);
  });

  it('keeps orphan type geometry of a pure type-library file, as the Model view does', () => {
    expect(selectDrawableMeshes([orphanType]).map((m) => m.expressId)).toEqual([3]);
  });

  it('applies the plan filter: spaces, openings and the site are not building fabric', () => {
    const others = [
      box(4, 'IfcSpace', [0.3, 0, 0.3], [3.7, 2.7, 3.7]),
      box(5, 'IfcOpeningElement', [1, 0.9, 0], [2, 2, 0.3]),
      box(6, 'IfcSite', [-10, -1, -10], [10, 0, 10]),
    ];
    const kept = selectDrawableMeshes([wall, wallType, ...others], PLAN_ELEMENT_FILTER);
    expect(kept.map((m) => m.expressId)).toEqual([1]);
  });

  it('honours caller include and exclude lists, case-insensitively', () => {
    const column = box(7, 'IfcColumn', [5, 0, 0], [5.3, 3, 0.3]);
    expect(selectDrawableMeshes([wall, column], { excludeTypes: ['ifccolumn'] }).map((m) => m.expressId)).toEqual([1]);
    expect(selectDrawableMeshes([wall, column], { includeTypes: ['IfcColumn'] }).map((m) => m.expressId)).toEqual([7]);
  });

  it('draws spaces as a room boundary with their label instead of a cut fill', async () => {
    const space = box(4, 'IfcSpace', [0.3, 0, 0.3], [3.7, 2.7, 3.7]);
    const drawing = await generateStoreyPlan([wall, space], {
      storeyElevation: 0,
      generator: fast,
      spaces: { labels: new Map([[4, 'Living']]) },
    });
    expect(polygonsOf(drawing, 4)).toEqual([]);
    expect(drawing.planSymbols?.filter((s) => s.kind === 'space').map((s) => s.entityId)).toEqual([4]);
    const label = drawing.planLabels?.find((l) => l.entityId === 4);
    expect(label?.text).toBe('Living');
    expect(label?.position.x).toBeCloseTo(2, 5);
    expect(label?.position.y).toBeCloseTo(2, 5);
    expect(exportToSVG(drawing)).toContain('>Living</text>');
  });
});

describe('goal 3: the plan cut is storey-relative in model coordinates', () => {
  it('maps a storey elevation through the render frame offsets', () => {
    expect(storeyCutElevation(3, 1.2)).toBeCloseTo(4.2, 9);
    expect(storeyCutElevation(103, 1.2, { wasmRtcOffset: { x: 0, y: 0, z: 100 } })).toBeCloseTo(4.2, 9);
    expect(storeyCutElevation(3, 1.2, { originShift: { x: 0, y: 2, z: 0 } })).toBeCloseTo(2.2, 9);
  });

  it('cuts 1.2 m above the storey floor of a re-centred model, not 1.2 m above the render origin', async () => {
    const frame = { wasmRtcOffset: { x: 0, y: 0, z: 101.69 } };
    const groundWall = box(1, 'IfcWall', [0, -1.69, 0], [4, 1.01, 0.3]);
    const lowStub = box(2, 'IfcWall', [5, -1.69, 0], [6, -0.8, 0.3]);
    const drawing = await generateStoreyPlan([groundWall, lowStub], { storeyElevation: 100, frame, generator: fast });
    expect(drawing.config.plane.position).toBeCloseTo(-0.49, 6);
    expect(polygonsOf(drawing, 1)).toHaveLength(1);
    expect(polygonsOf(drawing, 2)).toEqual([]);
  });
});

describe('goal 4: doors and windows draw as plan symbols', () => {
  const host = box(1, 'IfcWall', [0, 0, -0.1], [6, 2.7, 0]);

  it('emits one swing per IfcDoor crossing the cut, hinged per its operation type', async () => {
    const meshes = [host, ...door(20, [1, 0, 0]), ...door(21, [3, 0, 0]), ...door(22, [1, 3, 0])];
    const drawing = await generateStoreyPlan(meshes, {
      storeyElevation: 0,
      generator: fast,
      openings: new Map([[20, { operationType: 'SINGLE_SWING_LEFT' }], [21, { operationType: '.SINGLE_SWING_RIGHT.' }]]),
    });
    const doors = drawing.planSymbols?.filter((s) => s.kind === 'door') ?? [];
    expect(doors.map((s) => s.entityId).sort()).toEqual([20, 21]);
    const hinge = (id: number) => {
      const params = doors.find((s) => s.entityId === id)?.symbol?.parameters as DoorSwingParameters | undefined;
      if (!params) throw new Error(`no door symbol for ${id}`);
      return params.hingePoint;
    };
    expect(hinge(20).x).toBeCloseTo(1, 5);
    expect(hinge(21).x).toBeCloseTo(3.9, 5);
    for (const symbol of doors) {
      const params = symbol.symbol?.parameters as DoorSwingParameters;
      const tips = symbol.lines.flatMap((l) => [l.start, l.end]);
      expect(Math.min(...tips.map((p) => p.y))).toBeLessThan(params.hingePoint.y - 0.8);
      expect(params.width).toBeCloseTo(0.9, 5);
    }
    expect(polygonsOf(drawing, 20)).toEqual([]);
  });

  it('prefers the authored overall width over the mesh extent', async () => {
    const drawing = await generateStoreyPlan([host, ...door(20, [1, 0, 0], 1.0)], {
      storeyElevation: 0,
      generator: fast,
      openings: new Map([[20, { width: 0.885 }]]),
    });
    const params = drawing.planSymbols?.find((s) => s.entityId === 20)?.symbol?.parameters as DoorSwingParameters;
    expect(params.width).toBeCloseTo(0.885, 6);
  });

  it('draws a window symbol in each window opening on the cut', async () => {
    const window = box(30, 'IfcWindow', [4.5, 0.9, -0.1], [5.5, 2.0, 0], {
      localToWorld: [1, 0, 0, 4.5, 0, 1, 0, 0.9, 0, 0, 1, 0, 0, 0, 0, 1],
      localBounds: { min: [0, 0, -0.1], max: [1, 1.1, 0] },
    });
    const drawing = await generateStoreyPlan([host, window], { storeyElevation: 0, generator: fast });
    const windows = drawing.planSymbols?.filter((s) => s.kind === 'window') ?? [];
    expect(windows.map((s) => s.entityId)).toEqual([30]);
    expect(windows[0].lines.length).toBeGreaterThanOrEqual(3);
    expect(exportToSVG(drawing)).toMatch(/id="plan-symbols"/);
  });
});

describe('goal 5: cut walls are hatched by material category', () => {
  it('hatches every cut wall, with a default poché when no material is known', async () => {
    const walls = [box(1, 'IfcWall', [0, 0, 0], [4, 3, 0.3]), box(2, 'IfcWallStandardCase', [0, 0, 1], [4, 3, 1.3])];
    const svg = exportToSVG(await generateStoreyPlan(walls, { storeyElevation: 0, generator: fast }));
    const hatching = svg.slice(svg.indexOf('id="hatching"'));
    for (const id of [1, 2]) expect(hatching).toContain(`data-entity-id="${id}"`);
  });

  it('classifies common material names into drafting categories', () => {
    expect(classifyMaterialName('Leichtbeton 102890359')).toBe('concrete');
    expect(classifyMaterialName('Reinforced Concrete C30/37')).toBe('concrete');
    expect(classifyMaterialName('Kalksandstein')).toBe('masonry');
    expect(classifyMaterialName('Brick, common')).toBe('masonry');
    expect(classifyMaterialName('stone_sand-lime')).toBe('masonry');
    expect(classifyMaterialName('beton_gewapend_prefab-element')).toBe('concrete');
    expect(classifyMaterialName('Mineralwolle WLG 035')).toBe('insulation');
    expect(classifyMaterialName('Brettschichtholz GL24h')).toBe('timber');
    expect(classifyMaterialName('Steel S235')).toBe('steel');
    expect(classifyMaterialName('Gipskarton')).toBe('gypsum');
    expect(classifyMaterialName('Xyzzy')).toBeUndefined();
  });

  it('classifies roof coverings as roofing ahead of the masonry and concrete words they contain', () => {
    for (const name of ['Clay roof tiles', 'Tondachziegel', 'Dachziegel Biberschwanz', 'Concrete roof tiles', 'Betondachstein',
      'Dachstein', 'Pantile', 'Bitumen shingles', 'Natural slate', 'Schiefer', 'Tuile terre cuite', 'Ardoise', 'Keramische dakpan']) {
      expect(classifyMaterialName(name), name).toBe('roofing');
    }
    expect(classifyMaterialName('Ziegel')).toBe('masonry');
    expect(classifyMaterialName('Concrete C25/30')).toBe('concrete');
    expect(classifyMaterialName('Dachdämmung Steinwolle')).toBe('insulation');
  });

  it('switches the hatch pattern with the material category of the cut element', async () => {
    const walls = [box(1, 'IfcWall', [0, 0, 0], [4, 3, 0.3]), box(2, 'IfcWall', [0, 0, 1], [4, 3, 1.3])];
    const drawing = await generateStoreyPlan(walls, { storeyElevation: 0, generator: fast });
    const svg = exportToSVG(drawing, { materialCategories: new Map([[1, 'insulation'], [2, 'concrete']]) });
    expect(svg).toMatch(/data-entity-id="1"[^>]*data-hatch="insulation"/);
    expect(svg).toMatch(/data-entity-id="2"[^>]*data-hatch="concrete"/);
    const roof = exportToSVG(drawing, { materialCategories: new Map([[1, 'roofing']]) });
    expect(roof).toMatch(/data-entity-id="1"[^>]*data-hatch="roofing"/);
  });
});

describe('plan sheets are drawn north-up, sections height-up', () => {
  const pathY = (svg: string, id: number): number => {
    const m = new RegExp(`<path d="M ([-\\d.]+) ([-\\d.]+)[^"]*"[^>]*data-entity-id="${id}"`).exec(svg);
    if (!m) throw new Error(`no hatch path for ${id}`);
    return Number(m[2]);
  };

  it('puts IFC +Y (render -Z) at the top of a plan sheet', async () => {
    const south = box(1, 'IfcWall', [0, 0, 0], [4, 3, 0.3]);
    const north = box(2, 'IfcWall', [0, 0, -10.3], [4, 3, -10]);
    const svg = exportToSVG(await generateFloorPlan([south, north], 1.2, fast));
    expect(pathY(svg, 2)).toBeLessThan(pathY(svg, 1));
  });

  it('keeps model up at the top of a vertical section', async () => {
    const low = box(1, 'IfcSlab', [0, 0, 0], [4, 0.3, 4]);
    const high = box(2, 'IfcSlab', [0, 3, 0], [4, 3.3, 4]);
    const drawing = await new Drawing2DGenerator().generate([low, high], createSectionConfig('x', 2), fast);
    const svg = exportToSVG(drawing);
    expect(pathY(svg, 2)).toBeLessThan(pathY(svg, 1));
  });
});
