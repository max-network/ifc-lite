---
'@ifc-lite/create': minor
---

Doors and windows get a body built from parts: a window's lining ring, mullions and transoms per `PartitioningType` and glazing panes, a door's lining, leaves per `OperationType` and handles, each its own extruded solid with its own surface style. `Detail: 'box'` keeps the single solid; `LiningThickness`, `PartColors` and `Handle` tune the parts. `windowLayout` and `doorLayout` expose the layout. Retiring a product shape now also removes the styled items of the parts it removes, and their styles when nothing else uses them.
