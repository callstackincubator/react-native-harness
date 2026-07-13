---
__default__: minor
---

Test files now load faster, since Harness no longer resends code your app already has. This was previously an experimental opt-in and is now enabled by default; the old experimental flag still works but is deprecated in favor of the new `skipAlreadyIncludedModules` option.
