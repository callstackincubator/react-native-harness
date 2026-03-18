---
__default__: patch
---

Metro cache is now stored under `.harness/metro-cache` in the project root. Set `unstable__enableMetroCache: true` in your config to use it; Harness will log when reusing the cache between runs. In CI, you can cache `.harness/metro-cache` to speed up Metro bundling.
