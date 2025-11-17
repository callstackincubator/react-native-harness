# Playground

This is an app that you can use to test React Native Harness in practice. At its core, this is a basic React Native application, bootstrapped via React Native Community CLI.

## How to run React Native Harness?

First, you need to prepare a debug build and install it on a selected device. You can do this as you do for your normal React Native Community CLI app. See [React Native docs](https://reactnative.dev/docs/getting-started-without-a-framework) for details on how to build the app.

To run React Native Harness, you need to execute the `pnpm test:harness` command. It will collect all tests defined in `./src/__tests__` and execute them one by one. You are free to modify `rn-harness.config.mjs` to match your local environment, but remember not to include these changes in your pull requests.

See [the React Native Harness documentation](https://www.react-native-harness.dev/docs/getting-started/introduction) for details on how to configure the environment.
