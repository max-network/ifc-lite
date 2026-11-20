---
'@ifc-lite/create': patch
---

Moving or turning an element takes the parts it aggregates along. A stair moves with its flights: the flight placed relative to the stair is carried, a part placed on the storey moves as its own root. Before, the move was refused because the flight hung from the stair's placement without being part of the selection.
