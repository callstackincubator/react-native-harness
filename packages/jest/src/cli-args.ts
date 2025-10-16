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
      coerce: (value: string) => {
        if (!value || value.trim().length === 0) {
          throw new Error('harnessRunner must be a non-empty string');
        }
        return value.trim();
      },
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
