---
"@ifc-lite/drawing-2d": patch
---

`storeyCutElevation` and `generateStoreyPlan` add the building's local placement Z (`frame.buildingOrigin.z`) to `IfcBuildingStorey.Elevation`, which IFC measures from the building, not the site. A building placed 3 m above its site with a storey at Elevation 0 now cuts at 4.2 m instead of 1.2 m (see #10931).
