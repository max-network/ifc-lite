---
"@ifc-lite/drawing-2d": minor
---

Elevations and vertical sections. `generateElevation(meshes, { direction, frame })` draws a building seen along any horizontal IFC world X/Y direction from in front of all of it, and `generateVerticalSection(meshes, { direction, through, frame })` cuts it with the vertical plane through a point and projects what lies beyond. Both return the drawing in IFC world terms (x along the picture plane from the world origin, y the world Z), the picture plane's basis (`right`, `direction`, `planeOffset`), visible edges only, and the terrain (`IfcGeographicElement` by default): its visible upper outline, its cut by the plane, and every building line under the outline and not in front of it marked hidden, so a basement in the ground comes out dashed.

Hidden-line removal takes `cellBias` (extra depth bias in raster cells, so an edge on a surface steep to the view is not hidden by that surface) and `sampleSpacing` (the longest step between samples along a line), and `Drawing2DGenerator.generate` takes them per drawing through `hiddenLine`. Defaults are unchanged.
