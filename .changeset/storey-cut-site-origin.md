---
"@ifc-lite/drawing-2d": patch
---

`storeyCutElevation` and `generateStoreyPlan` read the storey elevation as `IfcBuildingStorey.Elevation`, relative to the site placement, and add the site's Z from `coordinateInfo.siteOrigin` before taking off the render-frame offsets. On a model whose IfcSite sits above zero (a Revit export at Z 14.23) the cut no longer lands below the storey and the plan is no longer empty (#10931).
