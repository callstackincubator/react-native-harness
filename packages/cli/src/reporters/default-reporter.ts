import chalk from 'chalk';
import type { SuiteResult, TestResult } from '@react-native-harness/bridge';
import { Reporter } from '@react-native-harness/config';

export const defaultReporter: Reporter = {
  report: async (results) => {
    console.log('\n📋 Test Results:');
    console.log(chalk.gray('━'.repeat(40)));

    for (const suite of results) {
      console.log(formatSuiteResult(suite));
    }

    console.log(chalk.gray('━'.repeat(40)));

    // Summary
    let totalPassed = 0,
      totalFailed = 0,
      totalSkipped = 0,
      totalTodo = 0;
    let totalDuration = 0;

    for (const suite of results) {
      const summary = getTestSummary(suite);
      totalPassed += summary.passed;
      totalFailed += summary.failed;
      totalSkipped += summary.skipped;
      totalTodo += summary.todo;
      totalDuration += suite.duration || 0;
    }

    console.log(
      `\n📊 Summary: ${chalk.green(`${totalPassed} passed`)}, ${chalk.red(
        `${totalFailed} failed`
      )}, ${chalk.yellow(`${totalSkipped} skipped`)}, ${chalk.blue(
        `${totalTodo} todo`
      )}`
    );
    console.log(`⏱️  Total time: ${formatDuration(totalDuration)}`);
  },
};

const formatDuration = (duration?: number): string => {
  if (!duration) return '';
  return chalk.gray(` (${duration}ms)`);
};

const getStatusIcon = (status: string): string => {
  switch (status) {
    case 'passed':
      return chalk.green('✓');
    case 'failed':
      return chalk.red('✗');
    case 'skipped':
      return chalk.yellow('○');
    case 'todo':
      return chalk.blue('◐');
    default:
      return '?';
  }
};

const formatTestResult = (test: TestResult, indent = ''): string => {
  const icon = getStatusIcon(test.status);
  const name = test.status === 'failed' ? chalk.red(test.name) : test.name;
  const duration = formatDuration(test.duration);

  let result = `${indent}${icon} ${name}${duration}`;

  if (test.error) {
    const errorLines = test.error.message?.split('\n') || [];
    result +=
      '\n' +
      errorLines
        .map((line: string) => `${indent}  ${chalk.red(line)}`)
        .join('\n');
  }

  return result;
};

const formatSuiteResult = (suite: SuiteResult, indent = ''): string => {
  const icon = getStatusIcon(suite.status);
  const name =
    suite.status === 'failed' ? chalk.red(suite.name) : chalk.bold(suite.name);
  const duration = formatDuration(suite.duration);

  let result = `${indent}${icon} ${name}${duration}`;

  if (suite.error) {
    const errorLines = suite.error.message.split('\n');
    result +=
      '\n' +
      errorLines
        .map((line: string) => `${indent}  ${chalk.red(line)}`)
        .join('\n');
  }

  const childIndent = indent + '  ';

  // Format tests
  for (const test of suite.tests) {
    result += '\n' + formatTestResult(test, childIndent);
  }

  // Format nested suites
  for (const childSuite of suite.suites) {
    result += '\n' + formatSuiteResult(childSuite, childIndent);
  }

  return result;
};

const getTestSummary = (
  suite: SuiteResult
): { passed: number; failed: number; skipped: number; todo: number } => {
  let passed = 0,
    failed = 0,
    skipped = 0,
    todo = 0;

  // Count tests in current suite
  for (const test of suite.tests) {
    switch (test.status) {
      case 'passed':
        passed++;
        break;
      case 'failed':
        failed++;
        break;
      case 'skipped':
        skipped++;
        break;
      case 'todo':
        todo++;
        break;
    }
  }

  // Count tests in nested suites
  for (const childSuite of suite.suites) {
    const childSummary = getTestSummary(childSuite);
    passed += childSummary.passed;
    failed += childSummary.failed;
    skipped += childSummary.skipped;
    todo += childSummary.todo;
  }

  return { passed, failed, skipped, todo };
};
