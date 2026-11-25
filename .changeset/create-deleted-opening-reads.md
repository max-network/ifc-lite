---
"@ifc-lite/create": patch
---

`readHostOpeningExtents` leaves out a void relationship whose opening was deleted in the same session instead of reporting it unreadable, so a hosted placement after a delete in one atomic batch is no longer refused. The roof-plane quantity refresh likewise stops counting a host as voided by a deleted opening. Both match what STEP export already drops.
