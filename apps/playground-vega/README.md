# Playground for Vega

A React Native for Vega app used to run React Native Harness on the Vega Virtual Device and on Fire TV devices running Vega OS. It mirrors the platform-agnostic test suites of `apps/playground`; the `ui/` suites are left out because `@react-native-harness/ui` has no Vega native module yet.

## Prerequisites

- The [Vega SDK](https://developer.amazon.com/docs/vega/0.24/install-vega-sdk) with the `vega` CLI on your `PATH` (`source ~/vega/env`).
- For Fire TV devices: developer mode enabled on the device (`vega devmode login`, then `vega devmode enable-device --code <code>`), and the device serial from `vega device list` exported as `VEGA_DEVICE_SERIAL`.

## How to run React Native Harness?

Build a debug package first. Debug builds load the JavaScript bundle from Metro, which is what Harness needs:

```sh
pnpm build:debug
```

The package lands in `build/<arch>-debug/playground-vega_<arch>.vpkg`. Use `aarch64` for the virtual device on Apple Silicon, `x86_64` on Intel, and `armv7` for Fire TV.

Then run the tests. Harness starts the virtual device when it is not running, installs the package from `HARNESS_APP_PATH`, and forwards Metro's port to the device:

```sh
HARNESS_APP_PATH=$PWD/build/aarch64-debug/playground-vega_aarch64.vpkg pnpm test:harness --harnessRunner vega
```

For a Fire TV:

```sh
VEGA_DEVICE_SERIAL=<serial> HARNESS_APP_PATH=$PWD/build/armv7-debug/playground-vega_armv7.vpkg pnpm test:harness --harnessRunner fire-tv
```

See [the React Native Harness documentation](https://www.react-native-harness.dev/docs/platforms/vega) for details.
