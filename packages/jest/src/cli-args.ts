import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

export type HarnessCliArgs = {
  harnessRunner?: string;
};

export const getAdditionalCliArgs = (): HarnessCliArgs => {
  const argv = yargs(hideBin(process.argv))
    .option('harnessRunner', {
      type: 'string',
      description: 'Specify which Harness runner to use',
    })
    .strict(false)
    .help(false)
    .version(false)
    .exitProcess(false)
    .parseSync();

  return {
    harnessRunner: argv.harnessRunner,
  };
};
