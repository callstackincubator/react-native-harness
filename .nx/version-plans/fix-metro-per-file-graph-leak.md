---
__default__: patch
---

Fixes an unbounded memory leak that OOM'd the Harness runner on suites with many test files. Each test file is fetched from Metro as its own bundle entry point, and Metro keeps a full dependency graph in memory per entry for delta updates — so the harness retained one graph (~tens of MB) per test file for the whole run, climbing until `JavaScript heap out of memory`. The runtime now releases each file's Metro graph once the file finishes (via the dev server's standard graph-release request), keeping memory flat regardless of how many test files a run contains.
