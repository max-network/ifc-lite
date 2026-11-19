/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * `@ifc-lite/validate/ifc4x3`: the IFC4X3 release on its own. The package root
 * loads each release on demand, which a bundler without code splitting
 * (esbuild, wrangler) inlines as all three; a writer that only emits IFC4X3
 * imports this entry and carries one schema.
 */

import type { ValidationReport } from './engine/findings.js';
import type { ValidateOptions } from './engine/validate.js';
import { SCHEMA } from './generated/ifc4x3/index.js';
import { validateStepTextWith } from './step-text.js';

export { SCHEMA };
export type { FindingCategory, ValidationFinding, ValidationReport } from './engine/findings.js';
export type { ValidateOptions } from './engine/validate.js';

/** Validate an IFC4X3 (including IFC4X3_ADD2) STEP text. */
export function validateIfc4x3StepText(text: string, options: ValidateOptions = {}): ValidationReport {
  return validateStepTextWith(SCHEMA, text, options);
}
