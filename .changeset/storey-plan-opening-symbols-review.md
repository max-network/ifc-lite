---
"@ifc-lite/drawing-2d": minor
---

`generateStoreyPlan` leaves out only the doors and windows it draws as symbols, so a door or window that does not cross the cut and is not one of the storey's elements keeps its projection linework instead of vanishing. `openings` is keyed by `makeEntityKey(modelIndex, expressId)`, so two federated models that hold the same express id get their own operation type and width. Callers that keyed it by express id alone wrap the key in `makeEntityKey(0, id)`.
