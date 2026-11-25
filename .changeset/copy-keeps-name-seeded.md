---
"@ifc-lite/create": patch
"@ifc-lite/sdk": patch
---

A seeded headless session no longer renames copies: `copyElements`, `copyToStoreys` and `arrayElements` pass the GlobalId seed through `CopyBatchOptions.guidRandom`, which leaves the duplicate naming policy off, so a copy of "W1" stays "W1". `mirrorElements(..., { copy: true })` now seeds the GlobalIds of the copy it makes. `duplicate.guidRandom` keeps working.
