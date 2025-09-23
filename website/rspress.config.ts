import * as path from 'node:path';
import { pluginCallstackTheme } from '@callstack/rspress-theme/plugin';
import { pluginLlms } from '@rspress/plugin-llms';
import { pluginOpenGraph } from 'rsbuild-plugin-open-graph';
import { defineConfig } from 'rspress/config';
import pluginSitemap from 'rspress-plugin-sitemap';

export default defineConfig({
  root: path.join(__dirname, 'src'),
  title: 'React Native Harness',
  icon: '/logo.svg',
  outDir: 'build',
  route: {
    cleanUrls: true,
  },
  logo: {
    light: '/logo-light.svg',
    dark: '/logo-dark.svg',
  },
  builderConfig: {
    plugins: [
      pluginOpenGraph({
        title: 'React Native Harness',
        type: 'website',
        url: 'https://react-native-harness.dev',
        image: 'https://react-native-harness.dev/og-image.jpg',
        description:
          'Bridge the testing gap: Jest-style tests in real native environments. Get the convenience of describe/it with full access to native modules.',
        twitter: {
          site: '@callstack',
          card: 'summary_large_image',
        },
      }),
    ],
  },
  themeConfig: {
    socialLinks: [
      {
        icon: 'github',
        mode: 'link',
        content: 'https://github.com/callstackincubator/react-native-harness',
      },
      {
        icon: 'discord',
        mode: 'link',
        content: 'https://discord.gg/xgGt7KAjxv',
      },
    ],
    footer: {
      message: `Copyright © ${new Date().getFullYear()} Callstack Open Source`,
    },
  },
  globalStyles: path.join(__dirname, 'theme/styles.css'),
  plugins: [
    pluginCallstackTheme(),
    pluginLlms({
      exclude: ({ page }) => page.routePath.includes('404'),
    }),
    // @ts-expect-error outdated @rspress/shared declared as dependency
    pluginSitemap({ domain: 'https://react-native-harness.dev' }),
  ],
});
