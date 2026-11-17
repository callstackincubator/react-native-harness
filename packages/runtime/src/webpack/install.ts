import { installHost } from '../host.js';
import { installModuleSystem } from '../module-system.js';
import { webpackHost } from './host.js';
import { createWebpackModuleSystem, type TestFiles } from './module-system.js';

/** Installs the browser implementations of the module system and the host. */
export const installWebpack = (files: TestFiles): void => {
  installModuleSystem(createWebpackModuleSystem(files));
  installHost(webpackHost);
};
