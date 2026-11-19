---
"@ifc-lite/validate": minor
---

`@ifc-lite/validate/ifc4x3` exports the IFC4X3 release (`SCHEMA`) and `validateIfc4x3StepText(text, options)`. The package root picks the release from `FILE_SCHEMA` through dynamic imports, which a bundler without code splitting (esbuild, wrangler) inlines as all three releases; a Worker that only writes IFC4X3 now bundles one.
