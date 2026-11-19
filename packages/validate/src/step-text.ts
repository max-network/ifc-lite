/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { Model } from './runtime/model.js';
import type { SchemaRuntime } from './runtime/schema-runtime.js';
import type { ValidationReport } from './engine/findings.js';
import { validateModel, type ValidateOptions } from './engine/validate.js';

/** Validate an IFC-SPF (STEP) text against one already loaded release. */
export function validateStepTextWith(schema: SchemaRuntime, text: string, options: ValidateOptions = {}): ValidationReport {
  return validateModel(Model.fromStepText(text, schema), { headerText: text, ...options });
}
