![harness-banner](https://react-native-harness.dev/harness-banner.jpg)

[![mit licence][license-badge]][license]
[![npm downloads][npm-downloads-badge]][npm-downloads]
[![Chat][chat-badge]][chat]
[![PRs Welcome][prs-welcome-badge]][prs-welcome]

Web platform for React Native Harness - enables testing on web browsers using Playwright.

## Installation

```bash
npm install @react-native-harness/platform-web
# or
pnpm add @react-native-harness/platform-web
# or
yarn add @react-native-harness/platform-web
```

## Usage

Import the Web platform functions in your `rn-harness.config.mjs`:

```javascript
import {
  webPlatform,
  chromium,
  chrome,
  firefox,
  webkit,
} from '@react-native-harness/platform-web';

const config = {
  runners: [
    webPlatform({
      name: 'web-chrome',
      browser: chrome('http://localhost:8081/index.html'),
    }),
    webPlatform({
      name: 'web-firefox-headful',
      browser: firefox('http://localhost:8081/index.html', { headless: false }),
    }),
  ],
  // ... other config
};

export default config;
```

## API

### `webPlatform(config)`

Creates a Web platform runner configuration.

**Parameters:**

- `config.name` - Unique name for the runner
- `config.browser` - Browser configuration (created via helper factories)

### Helper Factories

#### `chromium(url, options)`

#### `chrome(url, options)`

#### `firefox(url, options)`

#### `webkit(url, options)`

Convenience functions for creating browser configurations.

**Options:**

- `headless` - Whether to run the browser in headless mode (default: `true`)
- `channel` - Browser channel (e.g., `'chrome'`, `'msedge'`)
- `executablePath` - Path to a specific browser binary

## Requirements

- Browsers installed (handled by Playwright or use system browsers via `channel`)
- React Native project configured for web (e.g., `react-native-web`)

## Made with ❤️ at Callstack

`react-native-harness` is an open source project and will always remain free to use. If you think it's cool, please star it 🌟. [Callstack][callstack-readme-with-love] is a group of React and React Native geeks, contact us at [hello@callstack.com](mailto:hello@callstack.com) if you need any help with these or just want to say hi!

Like the project? ⚛️ [Join the team](https://callstack.com/careers/?utm_campaign=Senior_RN&utm_source=github&utm_medium=readme) who does amazing stuff for clients and drives React Native Open Source! 🔥

[callstack-readme-with-love]: https://callstack.com/?utm_source=github.com&utm_medium=referral&utm_campaign=react-native-harness&utm_term=readme-with-love
[license-badge]: https://img.shields.io/npm/l/react-native-harness?style=for-the-badge
[license]: https://github.com/callstackincubator/react-native-harness/blob/main/LICENSE
[npm-downloads-badge]: https://img.shields.io/npm/dm/react-native-harness?style=for-the-badge
[npm-downloads]: https://www.npmjs.com/package/react-native-harness
[prs-welcome-badge]: https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=for-the-badge
[prs-welcome]: ./CONTRIBUTING.md
[chat-badge]: https://img.shields.io/discord/426714625279524876.svg?style=for-the-badge
[chat]: https://discord.gg/xgGt7KAjxv
