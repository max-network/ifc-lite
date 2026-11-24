---
"@ifc-lite/create": patch
---

Re-cutting a wall to an edited roof no longer deletes unrelated records. The cleanup of the replaced cut followed every number in its attributes as a reference, and parsed source holds integral REALs (a coordinate of 32.) as numbers too, so a relationship whose id matched a coordinate (the building's IfcRelAggregates of its storeys) was removed with the cut. It now follows only slots that reference their target.
