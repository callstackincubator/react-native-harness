import { withCallstackPreset } from '@callstack/rspress-preset';
import path from 'node:path';

const DOCS_ROOT = 'src';
const EDIT_ROOT_URL = `https://github.com/callstackincubator/react-native-harness/tree/main/website/${DOCS_ROOT}`;

export default withCallstackPreset(
  {
    context: __dirname,
    docs: {
      description:
        'Jest-style tool for testing native behavior directly on devices.',
      editUrl: EDIT_ROOT_URL,
      icon: '/logo.svg',
      logoDark: '/logo-dark.svg',
      logoLight: '/logo-light.svg',
      ogImage: '/og-image.jpg',
      rootDir: DOCS_ROOT,
      rootUrl: 'https://react-native-harness.dev',
      socials: {
        github: 'https://github.com/callstackincubator/react-native-harness',
        discord: 'https://discord.gg/TWDBep3nXV',
      },
      title: 'React Native Harness',
    },
  },
  {
    outDir: 'build',
    globalStyles: path.join(__dirname, 'theme', 'styles.css'),
    themeConfig: {
      enableScrollToTop: true,
    },
  }
);
