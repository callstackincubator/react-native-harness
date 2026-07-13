---
__default__: patch
---

Fixes a hang where the harness process never exits after tests finish, most common on Android and occasional on iOS. A stray WebSocket connection to Metro's dev server (e.g. a half-open HMR client) could prevent the server from shutting down, leaving Jest running indefinitely until it was killed manually or by a CI timeout. Metro now force-closes any lingering connections when the harness tears down, so runs terminate reliably and Ctrl+C/SIGTERM work as expected.
