import { installHost } from '../host.js';
import { installModuleSystem } from '../module-system.js';
import { metroHost } from './host.js';
import { metroModuleSystem } from './module-system.js';

installModuleSystem(metroModuleSystem);
installHost(metroHost);
