import { formatGreeting } from '@app/lib/greeting';

declare global {
  var SETUP_FILE_EXECUTED_AFTER_ENV: boolean;
}

// Importing through the @app alias proves setup files use the project's resolver.
global.SETUP_FILE_EXECUTED_AFTER_ENV = formatGreeting('setup') === 'Hello, setup!';
export {};
