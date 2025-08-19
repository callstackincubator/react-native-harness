import {
  getBridgeServer,
  type BridgeServer,
} from '@react-native-harness/bridge/server';
import {
  Config,
  getConfig,
  TestRunnerConfig,
} from '@react-native-harness/config';
import type { SuiteResult } from '@react-native-harness/bridge';
import { getPlatformAdapter } from '../platforms/platform-registry.js';
import { Glob } from 'glob';
import { defaultReporter } from '../reporters/default-reporter.js';
import { intro, logger, outro, spinner } from '@react-native-harness/tools';
import { type Environment } from '../platforms/platform-adapter.js';
import { BridgeTimeoutError } from '../errors/errors.js';
import { promptConfirm } from '@react-native-harness/tools';
import { assert } from '../utils.js';
import {
  EnvironmentInitializationError,
  NoRunnerSpecifiedError,
  RpcClientError,
  RunnerNotFoundError,
  TestExecutionError,
} from '../errors/errors.js';

type TestRunContext = {
  config: Config;
  runner: TestRunnerConfig;
  bridge?: BridgeServer;
  environment?: Environment;
  testFiles?: string[];
  results?: SuiteResult[];
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
  pattern?: string
): Promise<void> => {
  const discoverSpinner = spinner();
  discoverSpinner.start('Discovering tests');

  const globPattern = pattern || context.config.include;
  const glob = new Glob(globPattern, {
    cwd: process.cwd(),
  });
  context.testFiles = await glob.walk();
  discoverSpinner.stop(`Found ${context.testFiles.length} test files`);
};

const runTests = async (context: TestRunContext): Promise<void> => {
  const { bridge, environment, testFiles } = context;
  assert(bridge != null, 'Bridge not initialized');
  assert(environment != null, 'Environment not initialized');
  assert(testFiles != null, 'Test files not initialized');

  const runSpinner = spinner();
  runSpinner.start('Running tests');

  let shouldRestart = false;

  for (const testFile of testFiles) {
    if (shouldRestart) {
      runSpinner.message(`Restarting environment for next test file`);

      await new Promise<void>((resolve) => {
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

    const result = await client.runTests(testFile);
    if (result.error) {
      await promptConfirm({
        message: 'An error occurred. Do you want to continue?',
      });
      throw new TestExecutionError(testFile, result.error);
    }

    context.results = [...(context.results ?? []), ...result.suites];
    shouldRestart = true;
  }

  runSpinner.stop(`Completed running all tests`);
};

const cleanUp = async (context: TestRunContext): Promise<void> => {
  if (context.bridge) {
    context.bridge.ws.close();
  }
  if (context.environment) {
    await context.environment.dispose();
  }
};

export const testCommand = async (
  runnerName?: string,
  pattern?: string
): Promise<void> => {
  intro('React Native Test Harness');

  const config = await getConfig(process.cwd());
  config.reporter = defaultReporter;

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
  };

  try {
    await setupEnvironment(context);
    await findTestFiles(context, pattern);
    await runTests(context);

    assert(context.results != null, 'Results not initialized');
    config.reporter?.report(context.results);
    outro('Test run completed successfully');
  } finally {
    await cleanUp(context);
  }
};
