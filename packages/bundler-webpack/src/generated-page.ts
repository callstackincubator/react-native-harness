import type { BuildSnapshot } from './build-snapshot.js';

const escapeAttribute = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/**
 * The page for a project whose build emits none: the element the runtime
 * mounts into, and the scripts of every entrypoint in the order the bundler
 * lists them.
 */
export const renderPage = ({
  scripts,
  styles,
}: Pick<BuildSnapshot, 'scripts' | 'styles'>): string =>
  `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>React Native Harness</title>
${styles.map((href) => `    <link rel="stylesheet" href="${escapeAttribute(href)}" />`).join('\n')}
  </head>
  <body>
    <div id="root"></div>
${scripts.map((src) => `    <script src="${escapeAttribute(src)}"></script>`).join('\n')}
  </body>
</html>
`;
