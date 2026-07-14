---
__default__: minor
---

Metro's transform and file-map caches now persist under `.harness/cache/metro` and `.harness/cache/metro-file-map` in your project root, enabled by default, so repeated Metro runs and CI jobs reuse work instead of rebuilding from scratch. Configure this with the new `cache.metro` and `cache.version` options; the previous `unstable__enableMetroCache` flag still works but is deprecated in favor of `cache.metro`. The official GitHub Action restores and saves the new cache paths automatically.
