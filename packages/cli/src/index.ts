import { Command } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { testCommand } from './commands/test.js';
import { handleError } from './errors/errorHandler.js';
import { logger } from '@react-native-harness/tools';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJsonPath = join(__dirname, '../package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));

const program = new Command();

program
  .name('react-native-harness')
  .description(
    'React Native Test Harness - A comprehensive testing framework for React Native applications'
  )
  .version(packageJson.version)
  .option('-v, --verbose', 'Enable verbose logging')
  .hook('preAction', (thisCommand) => {
    // Handle global verbose option
    const opts = thisCommand.optsWithGlobals();
    if (opts.verbose) {
      logger.setVerbose(true);
    }
  });

program
  .command('test')
  .description('Run tests using the specified runner')
  .argument(
    '[runner]',
    'test runner name (uses defaultRunner from config if not specified)'
  )
  .argument(
    '[pattern]',
    'glob pattern to match test files (uses config.include if not specified)'
  )
  .option(
    '-t, --testNamePattern <pattern>',
    'Run only tests with names matching regex pattern'
  )
  .option(
    '--testPathPattern <pattern>',
    'Run only test files with paths matching regex pattern'
  )
  .option(
    '--testPathIgnorePatterns <patterns...>',
    'Ignore test files matching these patterns'
  )
  .option(
    '--testMatch <patterns...>',
    'Override config.include with these glob patterns'
  )
  .action(async (runner, pattern, options) => {
    try {
      // Convert CLI pattern argument to testMatch option
      const mergedOptions = {
        ...options,
        testMatch: pattern ? [pattern] : options.testMatch,
      };

      await testCommand(runner, mergedOptions);
    } catch (error) {
      handleError(error);
      process.exit(1);
    }
  });

process.on('uncaughtException', (error) => {
  handleError(error);
  process.exit(1);
});

program.parse();
