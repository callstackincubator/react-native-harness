---
__default__: minor
---

The official GitHub Action now computes the Metro cache key itself instead of hashing a static file list: it accounts for your lockfile(s), Metro/Babel config, the resolved `@react-native-harness/bundler-metro` version, and your `cache.version` salt, so the cache invalidates automatically when you upgrade Metro, not only when a lockfile or config file changes. A new `cacheSavePolicy` action input (`'default-branch'` by default, or `'always'`/`'never'`) controls when a new cache entry is saved, and a run only saves a new entry when its cache contents actually changed.
