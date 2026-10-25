---
__default__: patch
---

On Android and iOS, `screen.screenshot()` of an element that has zero size or is no longer available now returns `null` instead of capturing the whole window.
