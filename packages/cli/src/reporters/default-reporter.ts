import { color, spinner } from '@react-native-harness/tools';
import type { TestSuiteResult, TestResult } from '@react-native-harness/bridge';
import { Reporter } from '@react-native-harness/config';

export const defaultReporter: Reporter = {
  report: async (results) => {
    const resultsSpinner = spinner();
    resultsSpinner.start('Test Results');

    for (const suite of results) {
      resultsSpinner.message(formatSuiteResult(suite));
    }

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

    const summaryText = [
      color.green(`${totalPassed} passed`),
      color.red(`${totalFailed} failed`),
      color.yellow(`${totalSkipped} skipped`),
      color.blue(`${totalTodo} todo`),
    ].join(', ');

    resultsSpinner.message(`Summary: ${summaryText}`);
    resultsSpinner.message(`Total time: ${formatDuration(totalDuration)}`);
  },
};

const formatDuration = (duration?: number): string => {
  if (duration == null) return '';
  return color.dim(` (${duration}ms)`);
};

const getStatusIcon = (status: string): string => {
  switch (status) {
    case 'passed':
      return color.green('✓');
    case 'failed':
      return color.red('✗');
    case 'skipped':
      return color.yellow('○');
    case 'todo':
      return color.blue('◐');
    default:
      return '?';
  }
};

const formatTestResult = (test: TestResult, indent = ''): string => {
  const icon = getStatusIcon(test.status);
  const name = test.status === 'failed' ? color.red(test.name) : test.name;
  const duration = formatDuration(test.duration);

  let result = `${indent}${icon} ${name}${duration}`;

  if (test.error) {
    const errorLines = test.error.message?.split('\n') || [];
    result +=
      '\n' +
      errorLines
        .map((line: string) => `${indent}  ${color.red(line)}`)
        .join('\n');
  }

  return result;
};

const formatSuiteResult = (suite: TestSuiteResult, indent = ''): string => {
  const icon = getStatusIcon(suite.status);
  const name =
    suite.status === 'failed' ? color.red(suite.name) : color.bold(suite.name);
  const duration = formatDuration(suite.duration);

  let result = `${indent}${icon} ${name}${duration}`;

  if (suite.error) {
    const errorLines = suite.error.message.split('\n');
    result +=
      '\n' +
      errorLines
        .map((line: string) => `${indent}  ${color.red(line)}`)
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
  suite: TestSuiteResult
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
