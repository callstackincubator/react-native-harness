---
__default__: patch
---

Fixes Metro prewarm so it actually warms the graph the app requests. On Expo projects, the prewarm request was missing several transform/query params the app's real bundle request uses, so the prewarmed graph was essentially always thrown away and rebuilt from scratch; on bare React Native it was missing `lazy=true`. Both client types now request byte-identical bundle URLs, so the prewarm work is no longer wasted, and a new guard logs a warning if the two URLs ever drift apart again.
