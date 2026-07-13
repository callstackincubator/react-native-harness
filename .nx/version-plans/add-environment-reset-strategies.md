---
__default__: minor
---

`resetEnvironmentBetweenTestFiles` now accepts `'runtime'` as a faster alternative to a full app restart between test files. Instead of relaunching the app, the runtime is reset in place, which noticeably speeds up suites with many test files while keeping each file isolated. Existing `true`/`false` settings keep working as before.
