import { harnessCliOptions } from '@react-native-harness/config';
import yargs, { type InferredOptionTypes } from 'yargs';
import { hideBin } from 'yargs/helpers';

export type HarnessCliArgs = InferredOptionTypes<typeof harnessCliOptions>;

export const getAdditionalCliArgs = (): HarnessCliArgs => {
  const argv = yargs(hideBin(process.argv))
    .options(harnessCliOptions)
    .strict(false)
    .help(false)
    .version(false)
    .exitProcess(false)
    .fail(false)
    .parseSync();

  return {
    harnessRunner: argv.harnessRunner,
    metroPort: argv.metroPort,
  };
};
