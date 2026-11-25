---
"@ifc-lite/codegen": patch
"@ifc-lite/validate": patch
---

The validator generator emits only the EXPRESS functions a rule, derived attribute or global rule reaches, directly or through another function, and only the enumeration constants that emitted code uses. `fn_IfcVectorSum`, which nothing calls, is no longer written into the generated `rules.ts` of each schema. Coverage counts are unchanged.
