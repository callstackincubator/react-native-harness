import { MetroPortSchema } from './types.js';

// The options Harness adds to Jest's command line. The CLI registers them with
// Jest's argument parser and the Jest integration reads them back, so an option
// listed here is both accepted and read.
export const harnessCliOptions = {
  harnessRunner: {
    type: 'string',
    description: 'Specify which Harness runner to use',
    requiresArg: true,
  },
  metroPort: {
    type: 'number',
    description: 'Set the preferred Metro port for this run',
    requiresArg: true,
    // Rejects a port the config would reject, before Jest starts any work.
    coerce: (value: unknown): number => {
      const result = MetroPortSchema.safeParse(value);
      if (!result.success) {
        throw new Error(
          `Invalid --metroPort: ${result.error.issues[0]?.message}`
        );
      }
      return result.data;
    },
  },
} as const;
