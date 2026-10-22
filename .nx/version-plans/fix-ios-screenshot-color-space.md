---
__default__: patch
---

Every iOS `screen.screenshot()` capture (full screen, region, and element, whether fully or partly on screen) is now 8-bit sRGB. Previously, on wide-colour devices and simulators, the on-screen capture paths produced 16-bit Display P3 images, so the same colour could differ depending on how it was captured. iOS image snapshots recorded on wide-colour devices will need to be re-recorded.
