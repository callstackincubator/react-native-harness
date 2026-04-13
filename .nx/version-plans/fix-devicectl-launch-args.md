---
__default__: patch
---

Physical iOS app launches now pass Harness launch arguments to `xcrun devicectl` without breaking JSON output collection. This prevents app launch arguments from being misinterpreted as `devicectl` flags and keeps device launches working when custom arguments are provided.
