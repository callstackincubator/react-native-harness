#!/usr/bin/env node

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

logger.setVerbose(true);

program
  .name('react-native-harness')
  .description(
    'React Native Test Harness - A comprehensive testing framework for React Native applications'
  )
  .version(packageJson.version);

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
  .action(async (runner, pattern) => {
    try {
      await testCommand(runner, pattern);
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
