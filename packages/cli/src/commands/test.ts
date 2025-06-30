import {
    getBridgeServer,
    type BridgeServer,
} from '@react-native-harness/bridge/server';
import {
    Config,
    getConfig,
    TestRunnerConfig,
    ConfigValidationError,
    ConfigNotFoundError,
    ConfigLoadError
} from '@react-native-harness/config';
import type { SuiteResult } from '@react-native-harness/bridge';
import { getPlatformAdapter } from '../platforms/platform-registry.js';
import { Glob } from 'glob';
import { defaultReporter } from '../reporters/default-reporter.js';
import { intro, outro, spinner } from '@react-native-harness/tools';
import { type Environment } from '../platforms/platform-adapter.js';
import { AppNotInstalledError } from '../errors/appNotInstalledError.js';

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

export const handleError = (error: unknown): void => {
    if (error instanceof ConfigValidationError) {
        console.error(`\n❌ Configuration Error`);
        console.error(`\nFile: ${error.filePath}`);
        console.error(`\nValidation errors:`);
        error.validationErrors.forEach(err => {
            console.error(`  • ${err}`);
        });
        console.error(`\nPlease fix the configuration errors and try again.`);
    } else if (error instanceof ConfigNotFoundError) {
        console.error(`\n❌ Configuration Not Found`);
        console.error(`\nCould not find 'rn-harness.config' in '${error.searchPath}' or any parent directories.`);
        console.error(`\nSupported file extensions: .js, .mjs, .cjs, .json`);
        console.error(`\nPlease create a configuration file or run from a directory that contains one.`);
    } else if (error instanceof ConfigLoadError) {
        console.error(`\n❌ Configuration Load Error`);
        console.error(`\nFile: ${error.filePath}`);
        console.error(`Error: ${error.message}`);
        if (error.cause) {
            console.error(`\nCause: ${error.cause.message}`);
        }
        console.error(`\nPlease check your configuration file syntax and try again.`);
    } else if (error instanceof AppNotInstalledError) {
        console.error(`\n❌ App Not Installed`);
        console.error(`\nThe app "${error.bundleId}" is not installed on ${error.platform === 'ios' ? 'simulator' : 'emulator'} "${error.deviceName}".`);
        console.error(`\nTo resolve this issue:`);
        if (error.platform === 'ios') {
            console.error(`  • Build and install the app: npx react-native run-ios --simulator="${error.deviceName}"`);
            console.error(`  • Or install from Xcode: Open ios/*.xcworkspace and run the project`);
        } else {
            console.error(`  • Build and install the app: npx react-native run-android`);
            console.error(`  • Or build manually: ./gradlew assembleDebug && adb install android/app/build/outputs/apk/debug/app-debug.apk`);
        }
        console.error(`\nPlease install the app and try running the tests again.`);
    } else {
        console.error(`\n❌ Unexpected Error`);
        console.error(error);
    }
};

export const testCommand = async (
    runnerName?: string,
    pattern?: string
): Promise<void> => {
    intro('React Native Test Harness');

    let config: Config;
    try {
        config = await getConfig(process.cwd());
        config.reporter = defaultReporter;
    } catch (error) {
        handleError(error);
        process.exit(1);
    }

    const selectedRunnerName = runnerName ?? config.defaultRunner;

    if (!selectedRunnerName) {
        console.error('\n❌ No runner specified');
        console.error('\nPlease specify a runner name or set a defaultRunner in your config.');
        console.error('\nUsage: react-native-harness test [runner-name] [pattern]');
        console.error('\nAvailable runners:');
        config.runners.forEach(r => {
            console.error(`  • ${r.name} (${r.platform})`);
        });
        process.exit(1);
    }

    const runner = config.runners.find((r) => r.name === selectedRunnerName);

    if (!runner) {
        console.error(`\n❌ Runner "${selectedRunnerName}" not found`);
        console.error('\nAvailable runners:');
        config.runners.forEach(r => {
            console.error(`  • ${r.name} (${r.platform})`);
        });
        process.exit(1);
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

        config.reporter?.report(context.results);
        outro('Test run completed successfully');

        await cleanUp(context);
        process.exit(0);
    } catch (error) {
        await cleanUp(context);
        handleError(error);
        process.exit(1);
    }
}; 