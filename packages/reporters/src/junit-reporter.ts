import type { TestSuiteResult, TestResult } from '@react-native-harness/bridge';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { Reporter } from './reporter.js';

export const junitReporter: Reporter = {
  report: async (results) => {
    const xml = generateJUnitXML(results);

    // Write to junit.xml file
    const outputPath = join(process.cwd(), 'junit.xml');
    writeFileSync(outputPath, xml, 'utf8');

    console.log(`📄 JUnit report written to: ${outputPath}`);
  },
};

const generateJUnitXML = (results: TestSuiteResult[]): string => {
  const { totalTests, totalFailures, totalSkipped, totalTime } =
    calculateTotals(results);

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += `<testsuites tests="${totalTests}" failures="${totalFailures}" skipped="${totalSkipped}" time="${
    totalTime / 1000
  }">\n`;

  for (const suite of results) {
    xml += generateTestSuiteXML(suite, '  ');
  }

  xml += '</testsuites>\n';

  return xml;
};

const generateTestSuiteXML = (
  suite: TestSuiteResult,
  indent: string
): string => {
  const { tests, failures, skipped, time } = getSuiteStats(suite);

  let xml = `${indent}<testsuite name="${escapeXML(
    suite.name
  )}" tests="${tests}" failures="${failures}" skipped="${skipped}" time="${
    time / 1000
  }"`;

  if (suite.error) {
    xml += ` errors="1"`;
  }

  xml += '>\n';

  // Add suite-level error if present
  if (suite.error) {
    xml += `${indent}  <error message="${escapeXML(
      suite.error.message || 'Suite failed'
    )}"`;
    if (suite.error.name) {
      xml += ` type="${escapeXML(suite.error.name)}"`;
    }
    xml += '>';
    if (suite.error.codeFrame) {
      xml += escapeXML(suite.error.codeFrame.content);
    }
    xml += '</error>\n';
  }

  // Add individual test cases
  for (const test of suite.tests) {
    xml += generateTestCaseXML(test, indent + '  ');
  }

  // Add nested suites
  for (const nestedSuite of suite.suites) {
    xml += generateTestSuiteXML(nestedSuite, indent + '  ');
  }

  xml += `${indent}</testsuite>\n`;

  return xml;
};

const generateTestCaseXML = (test: TestResult, indent: string): string => {
  const time = (test.duration || 0) / 1000;
  let xml = `${indent}<testcase name="${escapeXML(test.name)}" time="${time}"`;

  if (test.status === 'passed') {
    xml += '/>\n';
  } else {
    xml += '>\n';

    switch (test.status) {
      case 'failed':
        xml += `${indent}  <failure message="${escapeXML(
          test.error?.message || 'Test failed'
        )}"`;
        if (test.error?.name) {
          xml += ` type="${escapeXML(test.error.name)}"`;
        }
        xml += '>';
        if (test.error?.codeFrame) {
          xml += escapeXML(test.error.codeFrame.content);
        }
        xml += '</failure>\n';
        break;
      case 'skipped':
        xml += `${indent}  <skipped/>\n`;
        break;
      case 'todo':
        xml += `${indent}  <skipped message="TODO: Test not implemented"/>\n`;
        break;
    }

    xml += `${indent}</testcase>\n`;
  }

  return xml;
};

const calculateTotals = (
  results: TestSuiteResult[]
): {
  totalTests: number;
  totalFailures: number;
  totalSkipped: number;
  totalTime: number;
} => {
  let totalTests = 0;
  let totalFailures = 0;
  let totalSkipped = 0;
  let totalTime = 0;

  for (const suite of results) {
    const stats = getSuiteStats(suite);
    totalTests += stats.tests;
    totalFailures += stats.failures;
    totalSkipped += stats.skipped;
    totalTime += stats.time;
  }

  return { totalTests, totalFailures, totalSkipped, totalTime };
};

const getSuiteStats = (
  suite: TestSuiteResult
): {
  tests: number;
  failures: number;
  skipped: number;
  time: number;
} => {
  let tests = suite.tests.length;
  let failures = suite.tests.filter((t) => t.status === 'failed').length;
  let skipped = suite.tests.filter(
    (t) => t.status === 'skipped' || t.status === 'todo'
  ).length;
  let time = suite.duration || 0;

  // Add stats from nested suites
  for (const nestedSuite of suite.suites) {
    const nestedStats = getSuiteStats(nestedSuite);
    tests += nestedStats.tests;
    failures += nestedStats.failures;
    skipped += nestedStats.skipped;
    time += nestedStats.time;
  }

  return { tests, failures, skipped, time };
};

const escapeXML = (str: string): string => {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
};
