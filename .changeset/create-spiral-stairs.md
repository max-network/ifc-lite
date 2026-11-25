---
"@ifc-lite/create": minor
"@ifc-lite/sdk": minor
---

`addSpiralStairToStore` (and `bim.store.addSpiralStair`) writes a spiral stair: an IfcStair SPIRAL_STAIR aggregating one IfcStairFlight SPIRAL whose Body is a newel and one extruded tread per riser, each tread an IfcArbitraryClosedProfileDef sector with true arcs. `readSpiralStair` reads that canonical form back (centre, radii, start angle, turn, risers, tread angle, walking line, thickness) and `spiralStairEdges` gives the inner, outer and walking-line polylines a railing can follow. `readStairDimensions` keeps refusing it, so straight-flight edits and storey refits do not rewrite a spiral as a straight flight.
