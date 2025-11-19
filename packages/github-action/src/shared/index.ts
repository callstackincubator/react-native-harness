import { getConfig } from '@react-native-harness/config';
import path from 'node:path';
import fs from 'node:fs';

const run = async (): Promise<void> => {
  try {
    const projectRootInput = process.env.INPUT_PROJECTROOT;
    const runnerInput = process.env.INPUT_RUNNER;

    if (!runnerInput) {
      throw new Error('Runner input is required');
    }

    const projectRoot = projectRootInput
      ? path.resolve(projectRootInput)
      : process.cwd();

    console.info(`Loading React Native Harness config from: ${projectRoot}`);

    const { config } = await getConfig(projectRoot);

    const runner = config.runners.find((runner) => runner.name === runnerInput);

    if (!runner) {
      throw new Error(`Runner ${runnerInput} not found in config`);
    }

    const githubOutput = process.env.GITHUB_OUTPUT;
    if (!githubOutput) {
      throw new Error('GITHUB_OUTPUT environment variable is not set');
    }

    const output = `config=${JSON.stringify(runner)}\n`;
    fs.appendFileSync(githubOutput, output);
  } catch (error) {
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error('Failed to load Harness configuration');
    }

    process.exit(1);
  }
};

run();
