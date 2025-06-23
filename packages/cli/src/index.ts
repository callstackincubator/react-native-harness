import {
  getBridgeServer,
  type BridgeServer,
} from '@react-native-harness/bridge/server';
import { Config, getConfig, TestRunnerConfig } from '@react-native-harness/config';
import type { SuiteResult } from '@react-native-harness/bridge';
import { getPlatformAdapter } from './platforms/platform-registry.js';
import { Glob } from 'glob';
import { defaultReporter } from './reporters/default-reporter.js';
import { intro, outro, spinner } from '@react-native-harness/tools';
import { type Environment } from './platforms/platform-adapter.js';

type TestRunContext = {
  config: Config;
  runner: TestRunnerConfig;
  bridge?: BridgeServer;
  environment?: Environment;
  testFiles: string[];
  results: SuiteResult[];
};

const setupEnvironment = async (
  context: TestRunContext
): Promise<void> => {
  const startSpinner = spinner();
  const platform = context.runner.platform;

  startSpinner.start(`Starting "${context.runner.name}" (${platform}) runner`);

  const platformAdapter = await getPlatformAdapter(platform);
  const serverBridge = await getBridgeServer({
    port: 3001,
  });

  context.bridge = serverBridge;

  const readyPromise = new Promise<void>((resolve) =>
    serverBridge.once('ready', resolve)
  );

  context.environment = await platformAdapter.getEnvironment(context.runner);
  await readyPromise;

  if (!context.environment) {
    throw new Error('Failed to initialize environment');
  }

  serverBridge.rpc.functions.executeAction =
    context.environment.interactionEngine.executeAction;
  serverBridge.rpc.functions.executeQuery =
    context.environment.interactionEngine.executeQuery;
  serverBridge.rpc.functions.executeMatcher =
    context.environment.interactionEngine.executeMatcher;

  startSpinner.stop(`"${context.runner.name}" (${platform}) runner started`);
};

const findTestFiles = async (
  context: TestRunContext
): Promise<void> => {
  const discoverSpinner = spinner();
  discoverSpinner.start('Discovering tests');

  const glob = new Glob(context.config.include, {
    cwd: process.cwd(),
  });
  context.testFiles = await glob.walk();
  discoverSpinner.stop(`Found ${context.testFiles.length} test files`);
};

const runTests = async (context: TestRunContext): Promise<void> => {
  const runSpinner = spinner();
  runSpinner.start('Running tests');

  let shouldRestart = false;

  if (!context.bridge || !context.environment) {
    throw new Error('Bridge or environment not initialized');
  }

  for (const testFile of context.testFiles) {
    if (shouldRestart) {
      runSpinner.message(`Restarting environment for next test file`);
      await new Promise<void>((resolve) => {
        context.bridge!.once('ready', resolve);
        context.environment!.restart();
      });
    }

    runSpinner.message(`Running tests in ${testFile}`);
    const client = context.bridge.rpc.clients.at(-1);
    if (!client) {
      throw new Error('No RPC client available');
    }

    const result = await client.runTests(testFile);
    if (result.error) {
      throw new Error(String(result.error));
    }

    context.results.push(...result.suites);
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

const main = async (argv: string[]): Promise<void> => {
  intro('React Native Test Harness');

  const config = await getConfig(process.cwd());
  config.reporter = defaultReporter;

  const runnerName = argv[2] ?? config.defaultRunner;

  if (!runnerName) {
    throw new Error('No runner specified');
  }

  const runner = config.runners.find((r) => r.name === runnerName);

  if (!runner) {
    throw new Error(`Runner "${runnerName}" not found`);
  }

  const context: TestRunContext = {
    config,
    runner,
    testFiles: [],
    results: [],
  };

  try {
    await setupEnvironment(context);
    await findTestFiles(context);
    await runTests(context);

    config.reporter?.report(context.results);
    outro('Test run completed successfully');

    await cleanUp(context);
    process.exit(0);
  } catch (error) {
    await cleanUp(context);
    console.error(error);
    process.exit(1);
  }
};

process.on('uncaughtException', (error) => {
  console.error(error);
  process.exit(1);
});
void main(process.argv);