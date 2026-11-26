---
"@ifc-lite/create": minor
---

`addFlowPathElementToStore` takes a rectangular `Section` (Width, Height, optional WallThickness) instead of `OuterDiameter` and writes one IfcExtrudedAreaSolid of an IfcRectangleProfileDef (IfcRectangleHollowProfileDef with a wall) per path segment, its width kept horizontal, for rectangular ducts and flat channels. `emitRectangularSweep` writes the same solids for other products, such as an insulation covering around a rectangular run.
