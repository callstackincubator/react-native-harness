import type { HarnessCliModule } from '@react-native-harness/platforms';
import { runXCTestCommand } from './xctest-command.js';

const cli = {
  commands: [
    {
      name: 'xctest',
      run: async (args, context) => {
        const { buildXCTestAgent } = await import('./xctest-agent.js');

        await runXCTestCommand({
          args,
          cwd: context.cwd,
          xctest: { buildXCTestAgent },
        });
      },
    },
  ],
} satisfies HarnessCliModule;

export const commands = cli.commands;

export default cli;
