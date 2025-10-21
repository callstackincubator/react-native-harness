# Prior Art

React Native Harness stands on the shoulders of giants and wouldn't be possible without the incredible work of the open-source community.

## Inspiration

The idea for React Native Harness came from seeing how Marc Rousavy set up testing in [Nitro Modules](https://github.com/mrousavy/nitro). In his example app, he defines a set of tests and runs them directly in the native environment, reporting results back. It was brilliant but not generic - you'd have to copy and adapt his approach for each project. We thought "what if we could take this concept and make it a proper test runner that everyone could use?" That's how React Native Harness was born - taking his core idea to the next level with a generic, reusable solution.

## Open Source Libraries

React Native Harness leverages a powerful set of open-source libraries to implement its testing capabilities, with core components coming from both the Jest and Vitest ecosystems:

### From Jest

- **[Jest](https://github.com/jestjs/jest)** - The incredibly extensible Jest CLI forms the backbone of React Native Harness's command-line interface, providing watch mode, code coverage, filtering, and countless other features out of the box. The Jest team's focus on extensibility allowed us to wrap their CLI and add native runner support while inheriting all the powerful features developers already know and love.

### From Vitest

- **[@vitest/expect](https://github.com/vitest-dev/vitest)** - Provides the familiar `expect` assertion API that developers know and love
- **[@vitest/spy](https://github.com/vitest-dev/vitest)** - Enables powerful mocking and spying capabilities for comprehensive testing

### Additional Testing Libraries

- **[Chai](https://github.com/chaijs/chai)** - Assertion library that powers many of our testing utilities
- **[Sinon](https://github.com/sinonjs/sinon)** - Standalone test spies, stubs, and mocks for JavaScript

### Supporting Libraries

- **[Zustand](https://github.com/pmndrs/zustand)** - Lightweight state management for the test runtime
- **[event-target-shim](https://github.com/mysticatea/event-target-shim)** - EventTarget polyfill for consistent event handling
- **[react-native-url-polyfill](https://github.com/charpeni/react-native-url-polyfill)** - URL API polyfill for React Native environments

## Thank You

We extend our heartfelt gratitude to:

- **Marc Rousavy** for showing us how native module testing could actually work well. Their approach gave us the confidence that we could build something better for React Native testing.

- **Kræn Hansen** for jumping in early and helping shape what React Native Harness became. His ideas and feedback were crucial in getting the APIs and functionality right.

- **The Jest team** for creating an incredibly extensible CLI that we could build upon. Their architectural decisions to make Jest's CLI wrappable and extensible offloaded an enormous amount of work from us and made React Native Harness significantly better. Features like watch mode, code coverage, and advanced filtering came for free, allowing us to focus on the native testing integration.

- **The Vitest team** for building such solid, modular testing tools that we could actually use as a foundation. Their focus on performance and developer experience made our job a lot easier.

- **The broader open-source community** for all the libraries, tools, and ideas that make projects like this possible in the first place.

React Native Harness is our contribution back to this amazing ecosystem. We hope it helps developers test their React Native applications more effectively and bridges the gap that has existed for too long in mobile development testing.

---

_If you're working on something that builds upon React Native Harness, we'd love to hear about it! Feel free to reach out and let us know how you're using it._
