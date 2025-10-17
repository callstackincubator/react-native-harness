import {
  getBridgeServer,
  type BridgeServer,
} from '@react-native-harness/bridge/server';
import { TestExecutionOptions } from '@react-native-harness/bridge';
import {
  Config,
  getConfig,
  TestRunnerConfig,
} from '@react-native-harness/config';
import { getPlatformAdapter } from '../platforms/platform-registry.js';
import { intro, logger, outro, spinner } from '@react-native-harness/tools';
import { type Environment } from '../platforms/platform-adapter.js';
import { BridgeTimeoutError } from '../errors/errors.js';
import { assert } from '../utils.js';
import {
  EnvironmentInitializationError,
  NoRunnerSpecifiedError,
  RpcClientError,
  RunnerNotFoundError,
} from '../errors/errors.js';
import { TestSuiteResult } from '@react-native-harness/bridge';
import {
  discoverTestFiles,
  type TestFilterOptions,
} from '../discovery/index.js';

type TestRunContext = {
  config: Config;
  runner: TestRunnerConfig;
  bridge?: BridgeServer;
  environment?: Environment;
  testFiles?: string[];
  results?: TestSuiteResult[];
  projectRoot: string;
};

const setupEnvironment = async (context: TestRunContext): Promise<void> => {
  const startSpinner = spinner();
  const platform = context.runner.platform;

  startSpinner.start(`Starting "${context.runner.name}" (${platform}) runner`);

  const platformAdapter = await getPlatformAdapter(platform);
  const serverBridge = await getBridgeServer({
    port: 3001,
  });

  context.bridge = serverBridge;

  const readyPromise = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(
        new BridgeTimeoutError(
          context.config.bridgeTimeout,
          context.runner.name,
          platform
        )
      );
    }, context.config.bridgeTimeout);

    serverBridge.once('ready', () => {
      clearTimeout(timeout);
      resolve();
    });
  });

  context.environment = await platformAdapter.getEnvironment(context.runner);

  logger.debug('Waiting for bridge to be ready');
  await readyPromise;
  logger.debug('Bridge is ready');

  if (!context.environment) {
    throw new EnvironmentInitializationError(
      'Failed to initialize environment',
      context.runner.name,
      platform,
      'Platform adapter returned null environment'
    );
  }

  startSpinner.stop(`"${context.runner.name}" (${platform}) runner started`);
};

const findTestFiles = async (
  context: TestRunContext,
  options: TestFilterOptions = {}
): Promise<void> => {
  const discoverSpinner = spinner();
  discoverSpinner.start('Discovering tests');

  context.testFiles = await discoverTestFiles(
    context.projectRoot,
    context.config.include,
    options
  );

  discoverSpinner.stop(`Found ${context.testFiles.length} test files`);
};

const runTests = async (
  context: TestRunContext,
  options: TestFilterOptions = {}
): Promise<void> => {
  const { bridge, environment, testFiles, config } = context;
  assert(bridge != null, 'Bridge not initialized');
  assert(environment != null, 'Environment not initialized');
  assert(testFiles != null, 'Test files not initialized');

  let runSpinner = spinner();
  runSpinner.start('Running tests');

  let shouldRestart = false;

  for (const testFile of testFiles) {
    if (shouldRestart) {
      runSpinner = spinner();
      runSpinner.start(`Restarting environment for next test file`);

      await new Promise((resolve) => {
        bridge.once('ready', resolve);
        environment.restart();
      });
    }

    runSpinner.message(`Running tests in ${testFile}`);
    const client = bridge.rpc.clients.at(-1);
    if (!client) {
      throw new RpcClientError(
        'No RPC client available',
        3001,
        'No clients connected'
      );
    }

    // Pass only testNamePattern to runtime (file filtering already done)
    const executionOptions: TestExecutionOptions = {
      testNamePattern: options.testNamePattern,
    };

    const result = await client.runTests(testFile, executionOptions);
    context.results = [...(context.results ?? []), ...result.suites];

    if (config.resetEnvironmentBetweenTestFiles) {
      shouldRestart = true;
    }

    runSpinner.stop(`Test file ${testFile} completed`);
  }

  runSpinner.stop('Tests completed');
};

const cleanUp = async (context: TestRunContext): Promise<void> => {
  if (context.bridge) {
    context.bridge.dispose();
  }
  if (context.environment) {
    await context.environment.dispose();
  }
};

const hasFailedTests = (results: TestSuiteResult[]): boolean => {
  for (const suite of results) {
    // Check if the suite itself failed
    if (suite.status === 'failed') {
      return true;
    }

    // Check individual tests in the suite
    for (const test of suite.tests) {
      if (test.status === 'failed') {
        return true;
      }
    }

    // Recursively check nested suites
    if (suite.suites && hasFailedTests(suite.suites)) {
      return true;
    }
  }

  return false;
};

export const testCommand = async (
  runnerName?: string,
  options: TestFilterOptions = {}
): Promise<void> => {
  intro('React Native Test Harness');

  const { config, projectRoot } = await getConfig(process.cwd());
  const selectedRunnerName = runnerName ?? config.defaultRunner;

  if (!selectedRunnerName) {
    throw new NoRunnerSpecifiedError(config.runners);
  }

  const runner = config.runners.find((r) => r.name === selectedRunnerName);

  if (!runner) {
    throw new RunnerNotFoundError(selectedRunnerName, config.runners);
  }

  const context: TestRunContext = {
    config,
    runner,
    testFiles: [],
    results: [],
    projectRoot,
  };

  try {
    await setupEnvironment(context);
    await findTestFiles(context, options);
    await runTests(context, options);

    assert(context.results != null, 'Results not initialized');
    config.reporter?.report(context.results);
  } finally {
    await cleanUp(context);
  }

  // Check if any tests failed and exit with appropriate code
  if (hasFailedTests(context.results)) {
    outro('Test run completed with failures');
    process.exit(1);
  } else {
    outro('Test run completed successfully');
  }
};
