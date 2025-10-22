import { afterEach } from '../collector/functions.js';
import { cleanup } from './cleanup.js';

export const setup = () => {
  afterEach(() => {
    cleanup();
  });
};
