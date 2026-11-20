/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The picture plane of a vertical view (elevation or section): a camera plane
 * looking horizontally, re-based so drawing x runs along the plane from the
 * IFC world origin and drawing y is IFC world Z.
 */

import { totalYupOffset, type RenderFrameInfo } from '@ifc-lite/geometry/world-frame';
import type { Point2D, SectionPlaneConfig, Vec3 } from '../types.js';
import { vec3, vec3Dot } from '../math.js';
import { buildCameraSectionPlane, worldBoundsCorners, type WorldBounds3D } from '../view-plane.js';

const DEPTH_PAD = 1e-3;

export interface VerticalPlane {
  plane: SectionPlaneConfig;
  /** Depth of the kept window behind the plane, metres. */
  viewDepth: number;
  /** Drawing x direction as an IFC world X/Y unit vector. */
  right: Point2D;
  /** Viewing direction as an IFC world X/Y unit vector. */
  direction: Point2D;
  /** Signed distance of the plane from the IFC world origin along `direction`, metres. */
  planeOffset: number;
}

/** An IFC world X/Y direction in the render frame, whose Z axis runs south. */
function renderDirection(direction: Point2D): Vec3 {
  return vec3(direction.x, 0, -direction.y);
}

/** An IFC world X/Y point at render-frame height 0. */
function renderPoint(point: Point2D, shift: Vec3): Vec3 {
  return vec3(point.x - shift.x, 0, -point.y - shift.z);
}

/**
 * The plane looking along `direction` (IFC world X/Y). Without `through` it
 * stands in front of `bounds`, as an elevation does; with it, it passes
 * through that IFC world X/Y point, as a section does.
 */
export function verticalViewPlane(direction: Point2D, bounds: WorldBounds3D, frame?: RenderFrameInfo | null, through?: Point2D): VerticalPlane {
  const length = Math.hypot(direction.x, direction.y);
  if (!(length > 0) || !Number.isFinite(length)) throw new Error('A vertical view needs a horizontal viewing direction.');
  const unit = { x: direction.x / length, y: direction.y / length };
  const view = renderDirection(unit);
  const center = vec3((bounds.min.x + bounds.max.x) / 2, (bounds.min.y + bounds.max.y) / 2, (bounds.min.z + bounds.max.z) / 2);
  const camera = buildCameraSectionPlane({ position: vec3(center.x - view.x, center.y, center.z - view.z), target: center, up: vec3(0, 1, 0) }, bounds);
  const custom = camera.plane.customPlane;
  if (!custom) throw new Error('The camera plane has no basis.');
  const shift = totalYupOffset(frame);
  let { distance } = custom;
  let { viewDepth } = camera;
  if (through) {
    distance = vec3Dot(renderPoint(through, shift), custom.normal);
    const depths = worldBoundsCorners(bounds).map((corner) => vec3Dot(corner, view) + distance);
    viewDepth = Math.max(DEPTH_PAD, ...depths) + DEPTH_PAD;
  }
  const worldOrigin = vec3(-shift.x, -shift.y, -shift.z);
  const off = vec3Dot(worldOrigin, custom.normal) - distance;
  const origin = vec3(worldOrigin.x - custom.normal.x * off, worldOrigin.y - custom.normal.y * off, worldOrigin.z - custom.normal.z * off);
  return {
    plane: { ...camera.plane, position: origin[camera.plane.axis], customPlane: { ...custom, distance, origin } },
    viewDepth,
    right: { x: custom.tangent.x, y: -custom.tangent.z },
    direction: unit,
    planeOffset: -(distance + vec3Dot(shift, custom.normal)),
  };
}
