# Local Harness bench

Runs Harness against an iOS simulator in a Tart VM that approximates the
`macos-latest` GitHub runner, so CI-only failures can be investigated without
pushing to CI.

## What it approximates

CI resolves `macos-latest` to **`macos-26-arm64`** (macOS 26 Tahoe, arm64,
3 vCPU / 7 GB), with Xcode pinned to **26.4.1** by the workflow.

The VM uses `ghcr.io/cirruslabs/macos-tahoe-xcode:26.4.1` (67.6 GB), which ships
that exact Xcode plus an iOS 26.4 runtime and the iPhone 17 Pro device type that
`apps/playground/rn-harness.config.mjs` targets. The larger
`macos-runner:tahoe` image (194.8 GB) is closer to the runner image, but its
rolling tag makes no promise about the Xcode version — set `BENCH_IMAGE` to use
it anyway.

**Known deviations from CI:** guest Node is whatever the image ships (~24.15)
rather than the workflow's pinned 24.10.0; local NVMe is much faster than the
runner's storage; and Apple Silicon generation affects per-core speed.

## Requirements (host)

- Apple Silicon, ~150 GB free
- `brew install cirruslabs/cli/tart`
- `sshpass` (optional — falls back to the `/usr/bin/expect` that ships with macOS)
- **Xcode 26.4.1** at `/Applications/Xcode.app` (only for `prebuild`)

`xcode-select` may point elsewhere; `prebuild` sets `DEVELOPER_DIR` itself.

## Usage

```sh
./scripts/local-bench/bench prebuild   # host: build .app + harvest xctest agent
./scripts/local-bench/bench base       # once: pull image, provision (~long)
./scripts/local-bench/bench warm       # optional: bake in node_modules
./scripts/local-bench/bench run        # fresh VM per run — use for conclusions
```

For edit/debug cycles, one long-lived VM re-synced in place:

```sh
./scripts/local-bench/bench dev up
./scripts/local-bench/bench dev run
./scripts/local-bench/bench dev shell  # ssh in, e.g. to run a single suite
./scripts/local-bench/bench dev down
```

Results land in `.bench/out/<timestamp>/` (logs, diagnostics). `.bench/` is
gitignored.

The app and xctest agent are built **on the host** and copied in; the VM only
installs dependencies and builds the TypeScript, which is what's under test.
Rebuild them with `prebuild` when native code changes — a Debug build serves JS
from Metro, so TypeScript-only changes do not need it.

## Knobs

| variable | default | purpose |
| --- | --- | --- |
| `BENCH_CPU` | `3` | vCPU count; matches the hosted runner |
| `BENCH_MEMORY` | `7168` | MB; matches the hosted runner |
| `BENCH_DISK_OPTS` | *(empty)* | e.g. `caching=uncached,sync=full` — measured ~1.9x slower I/O |
| `BENCH_NET` | *(empty)* | `softnet` shortens DHCP leases; fixes ECONNRESET from ephemeral-VM churn (needs the `softnet` binary) |
| `BENCH_IMAGE` | `…macos-tahoe-xcode:26.4.1` | base image |
| `BENCH_KEY` | `~/.ssh/id_harness_bench` | generated on first `base` |

`taskpolicy` does **not** throttle guest I/O (measured: no effect). For precise
bandwidth control, tart can boot from an NBD URL backed by a rate-limited
server (`--disk nbd://…`).

## Caveat on flaky failures

`dev` reuses one VM, so simulator and Metro state accumulates between
iterations. When chasing a timing-dependent failure, that can both mask and
manufacture it — use `run`, which clones a fresh VM each time, for anything you
intend to draw conclusions from.
