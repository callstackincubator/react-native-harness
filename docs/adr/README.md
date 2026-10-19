# Architecture decision records

This directory records significant architectural decisions for React Native
Harness: what was decided, why, and what alternatives were rejected.

- One decision per file, named `NNNN-short-title.md` with a zero-padded,
  increasing number.
- Each record has a status: `Proposed`, `Accepted`, `Superseded by NNNN`, or
  `Rejected`.
- Accepted records are not rewritten. When a decision changes, add a new record
  and mark the old one as superseded.

| ADR | Title | Status |
| --- | --- | --- |
| [0001](0001-app-liveness-detection.md) | Detect unresponsive apps without penalizing long-running work | Proposed |
