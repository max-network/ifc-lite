---
"@ifc-lite/drawing-2d": minor
---

Storey plans can carry dimension chains. `generateStoreyPlan(meshes, { dimensions: {} })` adds `planDimensions`: per facade an openings chain (corners, steps and jambs on the outer face, doors and windows splitting the openings they fill), an optional grid chain and the overall length, stacked outward in paper millimetres, plus one interior chain per room and direction (clear span from the space outline, each interior wall once). Facades follow the building's principal axes, so a plan turned off the drawing axes is dimensioned along its walls. `exportToSVG` draws them in a `dimensions` layer. `buildPlanDimensions` works on any `Drawing2D`.

The linear-dimension geometry and its SVG writer (`linearDimensionGraphics`, `linearDimensionLength`, `dimensionsToSvg`, `placeDimensionText`, `boundsWithDimensions`) moved here from the viewer, which now draws its dimensions through them; `orientation` also accepts a unit direction and `textShift` moves a value clear of its neighbours.
