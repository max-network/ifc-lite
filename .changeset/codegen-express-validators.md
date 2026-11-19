---
"@ifc-lite/codegen": minor
"@ifc-lite/validate": minor
---

`@ifc-lite/codegen` now compiles the constraint side of an EXPRESS schema as well as its types. A tokenising EXPRESS parser reads WHERE, UNIQUE, DERIVE and INVERSE clauses, FUNCTIONs and global RULEs, and `generateValidators` (CLI: `--validators <dir>`) translates them to TypeScript plus zod 4 schemas for the authoring form of every entity and type. A construct the translator cannot compile is listed with its reason in the generated coverage and reported as not evaluated at runtime, never dropped. All WHERE rules, DERIVE expressions, FUNCTIONs and global RULEs of IFC2X3 TC1, IFC4 ADD2 TC1 and IFC4X3 compile.

The new `@ifc-lite/validate` package runs the generated rules on a parsed model (`validateDataStore`) or STEP text (`validateStepText`) and returns structured findings: schema checks (presence, types, aggregate bounds, INVERSE cardinality, derived slots, GlobalId format), defined-type and entity WHERE rules, UNIQUE and global rules. It has no Node built-in at runtime, so it runs in browsers and Workers. `packages/validate/parity` measures it against ifcopenshell.validate on a crafted broken-file corpus and third-party models.
