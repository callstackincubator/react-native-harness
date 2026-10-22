---
__default__: patch
---

On Android, capturing a screenshot of a region now covers exactly the pixels of a view laid out at the same position and size. Previously, fractional pixel densities could make the region one pixel smaller than the matching element capture.
