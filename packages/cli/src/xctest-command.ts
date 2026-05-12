import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

export type XCTestBuildDestination = 'simulator' | 'device';

export type XCTestBuildArgs = {
  destination: XCTestBuildDestination;
  provisioningProfile?: string;
  signingIdentity?: string;
  teamId?: string;
};

type XCTestBuildResult = {
  destination: XCTestBuildDestination;
  derivedDataPath: string;
  reused: boolean;
  xctestrunPath?: string;
};

export type PlatformAppleXCTestModule = {
  buildXCTestAgent: (options: {
    destination: XCTestBuildDestination;
    projectRoot: string;
    signing?: {
      provisioningProfile?: string;
      signingIdentity?: string;
      teamId?: string;
    };
  }) => Promise<XCTestBuildResult>;
};

export const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
};

const createXCTestYargs = (args: string[]) =>
  yargs(args)
    .scriptName('harness xctest')
    .command(
      'build',
      'Build the bundled iOS XCTest agent',
      (command) =>
        command
          .option('destination', {
            choices: ['simulator', 'device'] as const,
            demandOption: true,
            describe: 'Build destination',
            type: 'string',
          })
          .option('teamId', {
            describe: 'Apple development team ID for signed device builds',
            type: 'string',
          })
          .option('signingIdentity', {
            describe: 'Code signing identity for signed device builds',
            type: 'string',
          })
          .option('provisioningProfile', {
            describe:
              'Provisioning profile specifier for signed device builds',
            type: 'string',
          })
          .example(
            '$0 build --destination simulator',
            'Build unsigned simulator artifacts'
          )
          .example(
            '$0 build --destination device',
            'Build unsigned device artifacts'
          )
          .example(
            '$0 build --destination device --teamId BAJL5U28HC',
            'Build signed device artifacts'
          ),
      () => undefined
    )
    .demandCommand(1, 'Missing xctest command.')
    .strict()
    .help()
    .version(false)
    .exitProcess(false)
    .fail((message, error) => {
      throw error ?? new Error(message);
    });

const getParsedXCTestBuildArgv = (args: string[]) => {
  const parser = createXCTestYargs(['build', ...args]);
  const argv = parser.parseSync();
  const destination = argv.destination;
  const provisioningProfile = argv.provisioningProfile;
  const signingIdentity = argv.signingIdentity;
  const teamId = argv.teamId;

  return {
    destination: destination as XCTestBuildDestination,
    provisioningProfile:
      typeof provisioningProfile === 'string' ? provisioningProfile : undefined,
    signingIdentity:
      typeof signingIdentity === 'string' ? signingIdentity : undefined,
    teamId: typeof teamId === 'string' ? teamId : undefined,
  };
};

export const parseXCTestBuildArgs = (args: string[]): XCTestBuildArgs => {
  const argv = getParsedXCTestBuildArgv(args);

  return {
    destination: argv.destination,
    provisioningProfile: argv.provisioningProfile,
    signingIdentity: argv.signingIdentity,
    teamId: argv.teamId,
  };
};

export const runXCTestBuildCommand = async (options: {
  args: string[];
  cwd: string;
  platformApple: PlatformAppleXCTestModule;
}) => {
  const buildArgs = parseXCTestBuildArgs(options.args);
  const signing = {
    provisioningProfile: buildArgs.provisioningProfile,
    signingIdentity: buildArgs.signingIdentity,
    teamId: buildArgs.teamId,
  };
  const hasSigning =
    signing.provisioningProfile !== undefined ||
    signing.signingIdentity !== undefined ||
    signing.teamId !== undefined;
  const buildOptions = {
    destination: buildArgs.destination,
    projectRoot: options.cwd,
    signing: undefined as typeof signing | undefined,
  };

  if (hasSigning) {
    buildOptions.signing = signing;
  }

  const result = await options.platformApple.buildXCTestAgent(buildOptions);

  console.log('Built XCTest agent');
  console.log(`Destination: ${result.destination}`);
  console.log(`DerivedData: ${result.derivedDataPath}`);

  if (result.xctestrunPath) {
    console.log(`XCTestRun: ${result.xctestrunPath}`);
  }

  let reusedLabel = 'no';

  if (result.reused) {
    reusedLabel = 'yes';
  }

  console.log(`Reused: ${reusedLabel}`);
};

export const runXCTestCommand = async () => {
  const args = hideBin(process.argv).slice(1);
  const parser = createXCTestYargs(args);
  const argv = parser.parseSync();
  const commandName = String(argv._[0] ?? '');

  if (commandName !== 'build') {
    return;
  }

  let platformApple: PlatformAppleXCTestModule;

  try {
    const importedPlatformApple = await import(
      '@react-native-harness/platform-apple'
    );
    const unknownPlatformApple = importedPlatformApple as unknown;
    platformApple = unknownPlatformApple as PlatformAppleXCTestModule;
  } catch (error) {
    console.error(getErrorMessage(error));
    process.exit(1);
  }

  try {
    await runXCTestBuildCommand({
      args: args.slice(1),
      cwd: process.cwd(),
      platformApple,
    });
  } catch (error) {
    console.error(getErrorMessage(error));
    parser.showHelp();
    process.exit(1);
  }
};
