/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * `@ifc-lite/pointcloud/ifcx`: the IFCx point attribute decoders on their own.
 * The package root also carries the LAS/LAZ/E57 streaming sources, whose LAZ
 * decoder imports a Vite `?url` wasm asset; a parser that only reads IFCx
 * attributes imports this entry so any bundler can resolve it.
 */

export type { IfcxPointSource } from './point-source.js';
export type { DecodedPointChunk, PointCloudBBox, PointNormalState } from './types.js';
export {
  POINTCLOUD_ATTR,
  POINTCLOUD_ATTR_KEYS,
  decodeIfcxPointAttribute,
  decodeIfcxPointSource,
} from './from-ifcx-attributes.js';
