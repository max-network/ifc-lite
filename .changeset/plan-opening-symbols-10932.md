---
"@ifc-lite/drawing-2d": minor
---

`generateFloorPlan` draws doors and windows crossing the cut as plan symbols instead of cutting their bodies: one swing per `IfcDoor` (hinge and side from its `OperationType`) and a window symbol per `IfcWindow`, framed by the element's placement (`MeshData.localToWorld`). They come back as `Drawing2D.planSymbols` and `exportToSVG` renders them in a `plan-symbols` layer. Pass `openings` (operation type, partitioning, `OverallWidth`, host wall thickness per express id) for the authored values; without them a door swings `SINGLE_SWING_LEFT` at its mesh width. `openingSymbols: false` keeps the previous output. Door operation and window partitioning strings are now checked against the IFC enumerations instead of cast.
