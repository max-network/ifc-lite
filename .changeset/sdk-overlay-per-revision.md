---
"@ifc-lite/sdk": patch
---

A headless session reuses its pending overlay until the mutation view's revision changes. Relationship reads (`containedIn`, `decomposedBy`, `storey`, `related`) between two edits no longer rebuild the effective relationship overlay on every call, which made a scan over all products quadratic in the number of queued edits.
