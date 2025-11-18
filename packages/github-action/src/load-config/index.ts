import { getInput, info, setOutput, setFailed } from '@actions/core';
import { getConfig } from '@react-native-harness/config';
import path from 'node:path';

const run = async (): Promise<void> => {
  try {
    const projectRootInput = getInput('projectRoot');
    const runnerInput = getInput('runner');

    const projectRoot = projectRootInput
      ? path.resolve(projectRootInput)
      : process.cwd();

    info(`Loading React Native Harness config from: ${projectRoot}`);

    const { config } = await getConfig(projectRoot);

    const runner = config.runners.find((runner) => runner.name === runnerInput);

    if (!runner) {
      throw new Error(`Runner ${runnerInput} not found in config`);
    }

    setOutput('config', JSON.stringify(runner));
  } catch (error) {
    if (error instanceof Error) {
      setFailed(error.message);
    } else {
      setFailed('Failed to load Harness configuration');
    }
    process.exit(1);
  }
};

run();
